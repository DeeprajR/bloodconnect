import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { CONFIG_DEFAULTS } from '@blood-connect/config';
import {
  bagDiscards,
  bagQuarantines,
  bagReturns,
  bloodBags,
  rfidTags,
  tagAssignments,
  tagDiscrepancies,
  users,
} from '@blood-connect/db';
import { BAG_STATUSES, addDays, subtractDays, type BagStatus } from '@blood-connect/domain';
import { idGenerator, newId } from '@blood-connect/ids';
import { createFakeClock } from '@blood-connect/testing';
import {
  argon2Hasher,
  nodeTokens,
  type Actor,
  type Database,
  type UseCaseContext,
} from '@blood-connect/platform';

import { registerBag } from './inventory.js';
import {
  classifyTag,
  listOpenDiscrepancies,
  raiseTagDiscrepancy,
  releaseTag,
  resolveTag,
  resolveTagDiscrepancy,
} from './tags.js';
import {
  allowedOutcomes,
  defaultOutcome,
  discardBag,
  discardExpiredQuarantine,
  listQuarantine,
  resolveQuarantine,
  returnBag,
} from './returns.js';
import { expireStaleBags } from './inventory.js';

const testUrl = process.env['TEST_DATABASE_URL'];
const CENTRE_ID = '01930000-0000-7000-8000-000000000001';

/* ========================================================================== */
/* The classification, with no database at all                                */
/* ========================================================================== */

describe('the three collision cases (§4)', () => {
  const assigned = (bagId = 'bag-1') => ({ status: 'assigned', currentBagId: bagId });

  it('opens the intake form for a tag nothing is on', () => {
    expect(classifyTag(undefined, undefined).kind).toBe('unassigned');
    expect(classifyTag({ status: 'unassigned', currentBagId: null }, undefined).kind).toBe(
      'unassigned',
    );
  });

  it('calls a live bag coming back a return (case 1)', () => {
    // The unit is out — surplus, or taken in error. It is a return, and it must
    // not share a button with re-registering.
    expect(classifyTag(assigned(), 'issued').kind).toBe('return');
    expect(classifyTag(assigned(), 'reserved').kind).toBe('return');
  });

  it('calls a spent bag a tag reuse (case 2)', () => {
    for (const status of ['discarded', 'expired', 'lost', 'returned'] as const) {
      expect(classifyTag(assigned(), status).kind).toBe('reuse');
    }
  });

  it('blocks when the register thinks the bag is on the shelf (case 3)', () => {
    // Neither case. Something is wrong, and every possibility can put the wrong
    // unit into a patient.
    expect(classifyTag(assigned(), 'available').kind).toBe('blocked');
    // Quarantined counts too: it is physically in the centre, so a tag turning
    // up elsewhere means the same three things.
    expect(classifyTag(assigned(), 'quarantined').kind).toBe('blocked');
  });

  it('never puts a retired tag back into service', () => {
    expect(classifyTag({ status: 'retired', currentBagId: null }, undefined).kind).toBe(
      'retired',
    );
  });

  it('lands every bag status in exactly one case', () => {
    // Total by construction: a status nobody classified would reach the screen
    // as "unassigned" and open the intake form on a tag carrying a live unit.
    for (const status of BAG_STATUSES) {
      const kind = classifyTag(assigned(), status).kind;
      expect(['return', 'reuse', 'blocked']).toContain(kind);
    }
  });
});

describe('what a return may become (§4)', () => {
  it('offers the shelf only when the unit was barely out', () => {
    expect(allowedOutcomes('under_30m')).toContain('restock');
  });

  it('never offers the shelf when the time is unknown', () => {
    // §4: default to Quarantine when the out-of-storage time is unknown. The
    // conservative reading of "we do not know" is never the shelf.
    expect(allowedOutcomes('unknown')).not.toContain('restock');
    expect(defaultOutcome('unknown')).toBe('quarantine');
  });

  it('never offers the shelf past the limit', () => {
    expect(allowedOutcomes('over_limit')).not.toContain('restock');
    expect(allowedOutcomes('30m_to_limit')).not.toContain('restock');
  });

  it('always offers quarantine and discard', () => {
    for (const band of ['under_30m', '30m_to_limit', 'over_limit', 'unknown'] as const) {
      expect(allowedOutcomes(band)).toContain('quarantine');
      expect(allowedOutcomes(band)).toContain('discard');
    }
  });
});

/* ========================================================================== */
/* Against the real database                                                  */
/* ========================================================================== */

describe.skipIf(!testUrl)('returns, quarantine and discrepancies (§4, §7.5)', () => {
  const client = postgres(testUrl ?? '', { max: 8, onnotice: () => undefined });
  const db = drizzle(client) as unknown as Database;
  const clock = createFakeClock('2026-09-09T09:00:00.000Z');

  let counter: Actor;
  let counterId: string;
  /** A live bag must name the request it is held for — the CHECK says so. */
  let requestId: string;
  // A counter, not a slice of a UUIDv7: those share a prefix within a
  // millisecond, and three bags registered in one test collided on the unique
  // unit number.
  let seq = 0;

  const context = (actor: Actor = counter): UseCaseContext => ({
    db,
    clock,
    ids: idGenerator,
    ports: { hasher: argon2Hasher, tokens: nodeTokens },
    actor,
    correlationId: newId(),
    config: CONFIG_DEFAULTS,
  });

  beforeEach(async () => {
    await client`TRUNCATE hospital.audit_log, hospital.tag_discrepancies, hospital.bag_discards,
                          hospital.bag_quarantines, hospital.bag_returns,
                          hospital.decision_bags, hospital.centre_decisions,
                          hospital.tag_assignments, hospital.rfid_tags, hospital.blood_bags,
                          hospital.blood_requests, hospital.admissions, hospital.patients,
                          hospital.users RESTART IDENTITY CASCADE`;
    await client`INSERT INTO hospital.centres (id, name) VALUES (${CENTRE_ID}, 'Test centre')
                 ON CONFLICT (id) DO NOTHING`;
    await client`INSERT INTO hospital.product_shelf_lives (product, shelf_life_days) VALUES
                   ('whole_blood', 35), ('prbc', 42), ('platelet_concentrate', 5),
                   ('ffp', 365), ('cryoprecipitate', 365)
                 ON CONFLICT (product) DO NOTHING`;

    counterId = newId();
    counter = { kind: 'user', userId: counterId, role: 'blood_centre', districtScopeId: null };
    await db.insert(users).values({
      id: counterId,
      email: `counter-${counterId}@blood-connect.invalid`,
      fullName: 'Counter Staff',
      role: 'blood_centre',
      status: 'active',
      passwordHash: 'x'.repeat(20),
    });

    // A draft request, purely so a bag can legally be `issued` or `reserved`.
    // Written as SQL: this module may not name Module 1's tables in production
    // code, and a test is the one place that distinction does not apply.
    const doctorId = newId();
    const patientId = newId();
    const admissionId = newId();
    requestId = newId();
    await client`INSERT INTO hospital.users (id, email, full_name, role, status, password_hash)
                 VALUES (${doctorId}, ${`doctor-${doctorId}@blood-connect.invalid`},
                         'Dr Test', 'doctor', 'active', ${'x'.repeat(20)})`;
    await client`INSERT INTO hospital.patients
                   (id, name, age, age_unit, sex, blood_group, previous_transfusion)
                 VALUES (${patientId}, 'Test Patient', 40, 'years', 'male', 'O+', 'unknown')`;
    await client`INSERT INTO hospital.admissions (id, ip_no, patient_id, ward, admitted_at, status)
                 VALUES (${admissionId}, ${`IP-${admissionId.slice(0, 8)}`}, ${patientId},
                         '3B', now(), 'admitted')`;
    await client`INSERT INTO hospital.blood_requests (id, centre_id, admission_id, doctor_id, status)
                 VALUES (${requestId}, ${CENTRE_ID}, ${admissionId}, ${doctorId}, 'draft')`;
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  /** A registered bag on a tag, in whatever status the test needs. */
  async function bagOnTag(
    status: BagStatus = 'available',
    collectedDaysAgo = 0,
  ): Promise<{ bagId: string; tagUid: string; expiresAt: string }> {
    seq += 1;
    const tagUid = `TAG-${String(seq).padStart(4, '0')}-${newId()}`;
    const result = await registerBag(context(), {
      unitNumber: `U-${String(seq).padStart(4, '0')}-${newId()}`,
      bloodGroup: 'O+',
      product: 'prbc',
      collectedAt: subtractDays(clock.today(), collectedDaysAgo),
      source: 'Camp',
      labelExpiry: null,
      tagUid,
    });
    if (!result.ok) throw new Error('could not register a bag');

    if (status === 'issued') {
      await client`UPDATE hospital.blood_bags
                      SET status = 'issued', issued_to_request_id = ${requestId}, issued_at = now()
                    WHERE id = ${result.value.bagId}`;
    } else if (status === 'reserved') {
      await client`UPDATE hospital.blood_bags
                      SET status = 'reserved', reserved_for_request_id = ${requestId}
                    WHERE id = ${result.value.bagId}`;
    } else if (status !== 'available') {
      await client`UPDATE hospital.blood_bags SET status = ${status}
                    WHERE id = ${result.value.bagId}`;
    }

    return { bagId: result.value.bagId, tagUid, expiresAt: result.value.expiresAt };
  }

  /* ---------------------------------------------------------------- case 1 */

  describe('case 1 — the return', () => {
    it('restocks a unit that was barely out of storage', async () => {
      const { bagId, expiresAt } = await bagOnTag('issued');

      const result = await returnBag(context(), {
        bagId,
        outOfStorageBand: 'under_30m',
        coldChainDocumented: true,
        outcome: 'restock',
        note: 'Surplus, returned promptly',
      });

      expect(result.ok).toBe(true);
      const [bag] = await db.select().from(bloodBags).where(eq(bloodBags.id, bagId));
      expect(bag?.status).toBe('available');
      // **Never recalculated.** The expiry is a property of the donation, not
      // of the bag's travels (§4).
      expect(bag?.expiresAt).toBe(expiresAt);
    });

    it('never recalculates the expiry, whatever the outcome', async () => {
      for (const outcome of ['restock', 'quarantine', 'discard'] as const) {
        const { bagId, expiresAt } = await bagOnTag('issued');
        await returnBag(context(), {
          bagId,
          outOfStorageBand: outcome === 'restock' ? 'under_30m' : 'over_limit',
          coldChainDocumented: false,
          outcome,
          note: null,
          disposalRoute: outcome === 'discard' ? 'Clinical waste' : null,
        });

        const [bag] = await db.select().from(bloodBags).where(eq(bloodBags.id, bagId));
        // A unit does not become fresher for having been carried to a ward and
        // back. §5.5 asks for this to be a test rather than a review comment.
        expect(bag?.expiresAt).toBe(expiresAt);
      }
    });

    it('refuses to restock a unit whose time out of storage is unknown', async () => {
      const { bagId } = await bagOnTag('issued');

      const result = await returnBag(context(), {
        bagId,
        outOfStorageBand: 'unknown',
        coldChainDocumented: false,
        outcome: 'restock',
        note: null,
      });

      expect(result.ok).toBe(false);
      const [bag] = await db.select().from(bloodBags).where(eq(bloodBags.id, bagId));
      expect(bag?.status).toBe('issued');
    });

    it('refuses it at the database too, not only in the use case', async () => {
      const { bagId } = await bagOnTag('issued');

      // The rule is in a CHECK constraint, so no screen and no later code path
      // can put such a unit back on the shelf.
      await expect(
        client`INSERT INTO hospital.bag_returns
                 (id, bag_id, out_of_storage_band, cold_chain_documented, outcome, decided_by)
               VALUES (gen_random_uuid(), ${bagId}, 'unknown', false, 'restock', ${counterId})`,
      ).rejects.toThrow(/bag_returns_restock_check/);
    });

    it('opens a quarantine that names why', async () => {
      const { bagId } = await bagOnTag('issued');

      const result = await returnBag(context(), {
        bagId,
        outOfStorageBand: 'unknown',
        coldChainDocumented: false,
        outcome: 'quarantine',
        note: 'Ward could not say how long',
      });

      expect(result.ok && result.value.quarantineId !== null).toBe(true);
      const [row] = await db.select().from(bagQuarantines);
      expect(row?.reason).toContain('unknown');
      expect(row?.resolvedAt).toBeNull();

      const [bag] = await db.select().from(bloodBags).where(eq(bloodBags.id, bagId));
      expect(bag?.status).toBe('quarantined');
    });

    it('does not reopen the request the unit was issued against', async () => {
      const { bagId } = await bagOnTag('issued');
      await returnBag(context(), {
        bagId,
        outOfStorageBand: 'under_30m',
        coldChainDocumented: true,
        outcome: 'restock',
        note: null,
      });

      // §4: the centre decision stands, with the return recorded against it.
      const [decisionCount] = await client<{ n: number }[]>`
        SELECT count(*)::int AS n FROM hospital.centre_decisions
      `;
      expect(decisionCount?.n).toBe(0);
      expect(await db.select().from(bagReturns)).toHaveLength(1);
    });

    it('refuses a return for a bag that was never out', async () => {
      const { bagId } = await bagOnTag('available');

      const result = await returnBag(context(), {
        bagId,
        outOfStorageBand: 'under_30m',
        coldChainDocumented: true,
        outcome: 'restock',
        note: null,
      });
      expect(result.ok).toBe(false);
    });
  });

  /* ---------------------------------------------------------------- case 2 */

  describe('case 2 — release, then re-register', () => {
    it('releases a tag whose bag is finished, and leaves that bag alone', async () => {
      const { bagId, tagUid } = await bagOnTag('discarded');

      const result = await releaseTag(context(), tagUid, 'Tag moved to a new unit');
      expect(result.ok).toBe(true);

      const [tag] = await db.select().from(rfidTags).where(eq(rfidTags.tagUid, tagUid));
      expect(tag?.status).toBe('unassigned');
      expect(tag?.currentBagId).toBeNull();

      // The old bag's history stays intact — it is not edited into the new one.
      const [bag] = await db.select().from(bloodBags).where(eq(bloodBags.id, bagId));
      expect(bag?.status).toBe('discarded');

      const [assignment] = await db
        .select()
        .from(tagAssignments)
        .where(eq(tagAssignments.bagId, bagId));
      expect(assignment?.releasedAt).not.toBeNull();
      expect(assignment?.releaseReason).toBe('Tag moved to a new unit');
    });

    it('refuses to release a tag whose bag is still live', async () => {
      const { tagUid } = await bagOnTag('issued');

      // That is a return, not a release — and letting it through would strand a
      // unit nobody can find.
      const result = await releaseTag(context(), tagUid, 'Wrong button');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('TagUnavailable');
    });

    it('requires a reason', async () => {
      const { tagUid } = await bagOnTag('expired');
      const result = await releaseTag(context(), tagUid, '   ');
      expect(result.ok).toBe(false);
    });

    it('re-registers as a new bag with its own expiry, not an edit of the old', async () => {
      const { bagId: oldBagId, tagUid } = await bagOnTag('expired', 40);
      await releaseTag(context(), tagUid, 'Tag harvested');

      seq += 1;
      const fresh = await registerBag(context(), {
        unitNumber: `U-${String(seq).padStart(4, '0')}-${newId()}`,
        bloodGroup: 'A+',
        product: 'whole_blood',
        collectedAt: clock.today(),
        source: 'Camp',
        labelExpiry: null,
        tagUid,
      });

      expect(fresh.ok).toBe(true);
      if (!fresh.ok) return;

      // A new bag, with its own collection date and its own derived expiry.
      expect(fresh.value.bagId).not.toBe(oldBagId);
      expect(fresh.value.expiresAt).toBe(addDays(clock.today(), 35));

      // Two assignment rows for this tag: one closed, one open. That is how
      // "what was on this tag in March?" stays answerable.
      const assignments = await db
        .select()
        .from(tagAssignments)
        .where(eq(tagAssignments.tagUid, tagUid));
      expect(assignments).toHaveLength(2);
      expect(assignments.filter((row) => row.releasedAt === null)).toHaveLength(1);
    });

    it('retires a tag that cannot be trusted, for good', async () => {
      const { tagUid } = await bagOnTag('discarded');
      await releaseTag(context(), tagUid, 'Reads unreliably', { retire: true });

      const [tag] = await db.select().from(rfidTags).where(eq(rfidTags.tagUid, tagUid));
      expect(tag?.status).toBe('retired');

      // And it can never carry a bag again.
      seq += 1;
      const again = await registerBag(context(), {
        unitNumber: `U-${String(seq).padStart(4, '0')}-${newId()}`,
        bloodGroup: 'O+',
        product: 'prbc',
        collectedAt: clock.today(),
        source: null,
        labelExpiry: null,
        tagUid,
      });
      expect(again.ok).toBe(false);
    });
  });

  /* ---------------------------------------------------------------- case 3 */

  describe('case 3 — the discrepancy, which closes exactly three ways', () => {
    async function blocked(): Promise<{ tagUid: string; bagId: string; discrepancyId: string }> {
      const { tagUid, bagId } = await bagOnTag('available');
      const raised = await raiseTagDiscrepancy(context(), tagUid, 'Second bag presented');
      if (!raised.ok) throw new Error('could not raise');
      return { tagUid, bagId, discrepancyId: raised.value.discrepancyId };
    }

    it('offers no resolution on the intake transaction itself', async () => {
      const { tagUid } = await bagOnTag('available');

      seq += 1;
      const attempt = await registerBag(context(), {
        unitNumber: `U-${String(seq).padStart(4, '0')}-${newId()}`,
        bloodGroup: 'O+',
        product: 'prbc',
        collectedAt: clock.today(),
        source: null,
        labelExpiry: null,
        tagUid,
      });

      expect(attempt.ok).toBe(false);
      if (!attempt.ok && attempt.error.kind === 'TagUnavailable') {
        expect(attempt.error.case).toBe('register_conflict');
      }
      // Nothing was registered. The pressure to add a "use it anyway" button
      // will come from busy staff, and the answer is no.
      expect(await db.select().from(bloodBags)).toHaveLength(1);
    });

    it('raises one discrepancy per tag, not one per scan', async () => {
      const { tagUid } = await bagOnTag('available');
      const first = await raiseTagDiscrepancy(context(), tagUid, 'Presented again');
      const second = await raiseTagDiscrepancy(context(), tagUid, 'And again');

      expect(first.ok && first.value.alreadyOpen).toBe(false);
      expect(second.ok && second.value.alreadyOpen).toBe(true);
      // Two rows would split the investigation in two.
      expect(await db.select().from(tagDiscrepancies)).toHaveLength(1);
    });

    it('ending one: the conflicting bag is there, so the tag is retired', async () => {
      const { tagUid, bagId, discrepancyId } = await blocked();

      const result = await resolveTagDiscrepancy(
        context(),
        discrepancyId,
        'duplicate_tag',
        'Found the original on shelf 3. This second bag wears a cloned tag.',
      );

      expect(result.ok && result.value.tagRetired).toBe(true);

      const [tag] = await db.select().from(rfidTags).where(eq(rfidTags.tagUid, tagUid));
      expect(tag?.status).toBe('retired');
      // The bag that was there is untouched — it was never the problem.
      const [bag] = await db.select().from(bloodBags).where(eq(bloodBags.id, bagId));
      expect(bag?.status).toBe('available');
    });

    it('ending two: the bag is not there, so it is marked lost and the tag freed', async () => {
      const { tagUid, bagId, discrepancyId } = await blocked();

      const result = await resolveTagDiscrepancy(
        context(),
        discrepancyId,
        'bag_missing',
        'Searched the fridge and the theatre. It left without being scanned out.',
      );

      expect(result.ok && result.value.conflictingBagStatus).toBe('lost');

      const [bag] = await db.select().from(bloodBags).where(eq(bloodBags.id, bagId));
      // `lost`, not `discarded`: nobody knows where it went, and recording a
      // disposal route for it would be a fiction.
      expect(bag?.status).toBe('lost');
      expect(await db.select().from(bagDiscards)).toHaveLength(0);

      const [tag] = await db.select().from(rfidTags).where(eq(rfidTags.tagUid, tagUid));
      expect(tag?.status).toBe('unassigned');
    });

    it('ending three: a mis-scan changes nothing at all', async () => {
      const { tagUid, bagId, discrepancyId } = await blocked();

      const result = await resolveTagDiscrepancy(
        context(),
        discrepancyId,
        'mis_scan',
        'Wrong tag presented. The bag is on the shelf and so is its tag.',
      );

      expect(result.ok).toBe(true);
      const [tag] = await db.select().from(rfidTags).where(eq(rfidTags.tagUid, tagUid));
      expect(tag?.status).toBe('assigned');
      const [bag] = await db.select().from(bloodBags).where(eq(bloodBags.id, bagId));
      expect(bag?.status).toBe('available');
    });

    it('refuses to close one without saying what was found', async () => {
      const { discrepancyId } = await blocked();

      // §4: each ending requires the resolver's identity and a note. A row
      // closed without them records that somebody made it go away.
      const result = await resolveTagDiscrepancy(context(), discrepancyId, 'mis_scan', '   ');
      expect(result.ok).toBe(false);

      const [row] = await db.select().from(tagDiscrepancies);
      expect(row?.status).toBe('open');
    });

    it('refuses to close one without a named person', async () => {
      const { discrepancyId } = await blocked();
      const job: Actor = { kind: 'system', reason: 'nightly sweep' };

      const result = await resolveTagDiscrepancy(
        context(job),
        discrepancyId,
        'mis_scan',
        'Closed by a job',
      );
      expect(result.ok).toBe(false);
    });

    it('closes it once', async () => {
      const { discrepancyId } = await blocked();
      await resolveTagDiscrepancy(context(), discrepancyId, 'mis_scan', 'Nothing wrong');
      const again = await resolveTagDiscrepancy(
        context(),
        discrepancyId,
        'duplicate_tag',
        'Changed my mind',
      );

      expect(again.ok).toBe(false);
      const [row] = await db.select().from(tagDiscrepancies);
      expect(row?.finding).toBe('mis_scan');
    });

    it('is resolved by no scheduled job, ever (§4)', async () => {
      await blocked();
      await bagOnTag('quarantined', 400);

      /**
       * The guarantee §4 asks for, tested as an absence.
       *
       * Every scheduled thing in this module runs, and the discrepancy is still
       * open afterwards. It never auto-resolves and never expires — it is the
       * one alarm here worth being loud.
       */
      await expireStaleBags(context());
      await discardExpiredQuarantine(context());

      const open = await listOpenDiscrepancies(context());
      expect(open).toHaveLength(1);
      expect(open[0]?.conflictingUnitNumber).toBeTruthy();
    });
  });

  /* ------------------------------------------------------------ quarantine */

  describe('quarantine — a waiting room, not a destination', () => {
    async function quarantined(collectedDaysAgo = 0): Promise<string> {
      const { bagId } = await bagOnTag('issued', collectedDaysAgo);
      await returnBag(context(), {
        bagId,
        outOfStorageBand: 'unknown',
        coldChainDocumented: false,
        outcome: 'quarantine',
        note: null,
      });
      return bagId;
    }

    it('shows how long each unit has been waiting', async () => {
      await quarantined();
      const rows = await listQuarantine(context());

      expect(rows).toHaveLength(1);
      expect(rows[0]?.daysWaiting).toBe(0);
      expect(rows[0]?.overdue).toBe(false);
    });

    it('escalates one that has waited past the threshold', async () => {
      await quarantined();
      const past = new Date(
        clock.now().getTime() - (CONFIG_DEFAULTS.ageing.quarantineDays + 1) * 86_400_000,
      );
      await client`UPDATE hospital.bag_quarantines
                      SET opened_at = ${past.toISOString()}::timestamptz`;

      const [row] = await listQuarantine(context());
      // Quarantined units age visibly, and one unresolved past a threshold is
      // escalated (§4).
      expect(row?.overdue).toBe(true);
    });

    it('resolves back to the shelf, by a named person', async () => {
      const bagId = await quarantined();
      const [row] = await db.select().from(bagQuarantines);

      const result = await resolveQuarantine(
        context(),
        row?.id ?? '',
        'available',
        'Ward confirmed it was in the transport fridge throughout.',
      );

      expect(result.ok).toBe(true);
      const [bag] = await db.select().from(bloodBags).where(eq(bloodBags.id, bagId));
      expect(bag?.status).toBe('available');

      const [resolved] = await db.select().from(bagQuarantines);
      expect(resolved?.resolvedBy).toBe(counterId);
    });

    it('resolves to discarded only with somewhere for it to go', async () => {
      await quarantined();
      const [row] = await db.select().from(bagQuarantines);

      const noRoute = await resolveQuarantine(context(), row?.id ?? '', 'discarded', 'Not usable');
      expect(noRoute.ok).toBe(false);

      const withRoute = await resolveQuarantine(
        context(),
        row?.id ?? '',
        'discarded',
        'Not usable',
        'Clinical waste, incinerator',
      );
      expect(withRoute.ok).toBe(true);

      const [discard] = await db.select().from(bagDiscards);
      // A status change is not the end of the bag (§12.1).
      expect(discard?.disposalRoute).toBe('Clinical waste, incinerator');
    });

    it('discards a quarantined unit that reaches its expiry, with that as the reason', async () => {
      // The single automatic exit §4 grants — nothing sits here indefinitely.
      const bagId = await quarantined(60);
      await client`UPDATE hospital.blood_bags SET expires_at = ${subtractDays(clock.today(), 1)}
                    WHERE id = ${bagId}`;

      const result = await discardExpiredQuarantine(context());
      expect(result.discarded).toBe(1);

      const [bag] = await db.select().from(bloodBags).where(eq(bloodBags.id, bagId));
      expect(bag?.status).toBe('discarded');

      const [discard] = await db.select().from(bagDiscards);
      expect(discard?.reason).toBe('Expired while in quarantine');
      // Still a route, because the unit is physically present and still needs
      // disposing of.
      expect(discard?.disposalRoute).toBeTruthy();

      const [quarantine] = await db.select().from(bagQuarantines);
      expect(quarantine?.resolvedAt).not.toBeNull();
    });

    it('leaves a quarantined unit out of the shelf until somebody decides', async () => {
      await quarantined();
      const available = await db
        .select()
        .from(bloodBags)
        .where(eq(bloodBags.status, 'available'));
      expect(available).toHaveLength(0);
    });
  });

  /* --------------------------------------------------------------- discard */

  describe('discarding a unit (§12.1)', () => {
    it('requires a disposal route', async () => {
      const { bagId } = await bagOnTag('available');

      const noRoute = await discardBag(context(), bagId, 'Haemolysed', '   ');
      expect(noRoute.ok).toBe(false);

      const withRoute = await discardBag(
        context(),
        bagId,
        'Haemolysed',
        'Clinical waste, incinerator',
      );
      expect(withRoute.ok).toBe(true);
    });

    it('refuses it at the database too', async () => {
      const { bagId } = await bagOnTag('available');
      await expect(
        client`INSERT INTO hospital.bag_discards (id, bag_id, reason, disposal_route)
               VALUES (gen_random_uuid(), ${bagId}, 'Haemolysed', '   ')`,
      ).rejects.toThrow(/bag_discards_route_check/);
    });

    it('discards a unit once', async () => {
      const { bagId } = await bagOnTag('available');
      await discardBag(context(), bagId, 'Haemolysed', 'Clinical waste');
      const again = await discardBag(context(), bagId, 'Again', 'Clinical waste');

      expect(again.ok).toBe(false);
      expect(await db.select().from(bagDiscards)).toHaveLength(1);
    });

    it('lets an expired unit be discarded, because expired is not the end', async () => {
      const { bagId } = await bagOnTag('expired');
      // §12.1: an expired unit is still physically present and still needs a
      // disposal route.
      const result = await discardBag(context(), bagId, 'Expired', 'Clinical waste');
      expect(result.ok).toBe(true);
    });

    it('closes any open quarantine with it', async () => {
      const { bagId } = await bagOnTag('issued');
      await returnBag(context(), {
        bagId,
        outOfStorageBand: 'unknown',
        coldChainDocumented: false,
        outcome: 'quarantine',
        note: null,
      });

      await discardBag(context(), bagId, 'Decided against restocking', 'Clinical waste');

      const [row] = await db.select().from(bagQuarantines);
      // A bag cannot be both waiting for a decision and finished.
      expect(row?.resolvedAt).not.toBeNull();
      expect(row?.resolution).toBe('discarded');
    });
  });

  /* ------------------------------------------------------------- resolving */

  it('shows the whole bag when a tag is presented (§4)', async () => {
    const { tagUid, bagId } = await bagOnTag('issued');

    const result = await resolveTag(context(), tagUid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // "Group, product, collection, expiry, status" — a screen that says only
    // "tag in use" makes somebody guess which of three things happened.
    expect(result.value.resolution.kind).toBe('return');
    expect(result.value.bag?.id).toBe(bagId);
    expect(result.value.bag?.bloodGroup).toBe('O+');
    expect(result.value.bag?.expiresAt).toBeTruthy();
  });

  it('does not let a doctor operate the register', async () => {
    const doctor: Actor = {
      kind: 'user',
      userId: newId(),
      role: 'doctor',
      districtScopeId: null,
    };
    const result = await resolveTag(context(doctor), 'TAG-1');
    expect(result.ok).toBe(false);
  });
});
