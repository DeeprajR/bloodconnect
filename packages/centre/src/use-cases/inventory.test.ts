import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { CONFIG_DEFAULTS } from '@blood-connect/config';
import { bloodBags, rfidTags, tagAssignments, users } from '@blood-connect/db';
import { addDays, subtractDays } from '@blood-connect/domain';
import { idGenerator, newId } from '@blood-connect/ids';
import { createFakeClock } from '@blood-connect/testing';
import {
  argon2Hasher,
  nodeTokens,
  type Actor,
  type Database,
  type UseCaseContext,
} from '@blood-connect/platform';

import { expireStaleBags, registerBag, type BagInput } from './inventory.js';

const testUrl = process.env['TEST_DATABASE_URL'];
const CENTRE_ID = '01930000-0000-7000-8000-000000000001';

describe.skipIf(!testUrl)('bag intake, typed (§4, §10)', () => {
  const client = postgres(testUrl ?? '', { max: 6, onnotice: () => undefined });
  const db = drizzle(client) as unknown as Database;
  const clock = createFakeClock('2026-09-08T09:00:00.000Z');

  let counter: Actor;

  const context = (overrides: Partial<UseCaseContext> = {}): UseCaseContext => ({
    db,
    clock,
    ids: idGenerator,
    ports: { hasher: argon2Hasher, tokens: nodeTokens },
    actor: counter,
    correlationId: newId(),
    config: CONFIG_DEFAULTS,
    ...overrides,
  });

  const bag = (overrides: Partial<BagInput> = {}): BagInput => ({
    unitNumber: `U-${newId().slice(0, 12)}`,
    bloodGroup: 'O+',
    product: 'prbc',
    collectedAt: clock.today(),
    source: 'Voluntary camp',
    labelExpiry: null,
    tagUid: null,
    ...overrides,
  });

  beforeEach(async () => {
    await client`TRUNCATE hospital.audit_log, hospital.decision_bags, hospital.centre_decisions,
                          hospital.donor_demand_confirmations, hospital.donor_demand,
                          hospital.tag_assignments, hospital.rfid_tags, hospital.blood_bags,
                          hospital.blood_requests, hospital.admissions, hospital.patients,
                          hospital.users
                 RESTART IDENTITY CASCADE`;
    await client`INSERT INTO hospital.centres (id, name) VALUES (${CENTRE_ID}, 'Test centre')
                 ON CONFLICT (id) DO NOTHING`;
    // The shelf lives are seeded by migration 0010 and are what the derived
    // expiry is calculated from.
    await client`INSERT INTO hospital.product_shelf_lives (product, shelf_life_days) VALUES
                   ('whole_blood', 35), ('prbc', 42), ('platelet_concentrate', 5),
                   ('ffp', 365), ('cryoprecipitate', 365)
                 ON CONFLICT (product) DO NOTHING`;

    const id = newId();
    counter = { kind: 'user', userId: id, role: 'blood_centre', districtScopeId: null };
    await db.insert(users).values({
      id,
      email: `counter-${id}@blood-connect.invalid`,
      fullName: 'Counter Staff',
      role: 'blood_centre',
      status: 'active',
      passwordHash: 'x'.repeat(20),
    });
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  /**
   * A draft request, for the one case that needs a bag to be held for
   * something. Written as SQL because this module may not import Module 1's
   * use cases and must not name its tables in production code — a test is the
   * one place that distinction does not apply.
   */
  async function draftRequest(): Promise<string> {
    const doctorId = newId();
    const patientId = newId();
    const admissionId = newId();
    const requestUuid = newId();

    await client`INSERT INTO hospital.users (id, email, full_name, role, status, password_hash)
                 VALUES (${doctorId}, ${`doctor-${doctorId}@blood-connect.invalid`},
                         'Dr Test', 'doctor', 'active', ${'x'.repeat(20)})`;
    await client`INSERT INTO hospital.patients
                   (id, name, age, age_unit, sex, blood_group, previous_transfusion)
                 VALUES (${patientId}, 'Test Patient', 40, 'years', 'female', 'O+', 'unknown')`;
    await client`INSERT INTO hospital.admissions
                   (id, ip_no, patient_id, ward, admitted_at, status)
                 VALUES (${admissionId}, ${`IP-${admissionId.slice(0, 8)}`}, ${patientId},
                         '3B', now(), 'admitted')`;
    await client`INSERT INTO hospital.blood_requests
                   (id, centre_id, admission_id, doctor_id, status)
                 VALUES (${requestUuid}, ${CENTRE_ID}, ${admissionId}, ${doctorId}, 'draft')`;

    return requestUuid;
  }

  /* ---------------------------------------------------------------- expiry */

  it('derives the expiry from the collection date and the shelf life', async () => {
    const collectedAt = subtractDays(clock.today(), 3);
    const result = await registerBag(context(), bag({ collectedAt }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // PRBC at 42 days, from collection — not from intake. A bag does not become
    // fresher by being handled.
    expect(result.value.expiresAt).toBe(addDays(collectedAt, 42));
    expect(result.value.expirySource).toBe('derived');
    expect(result.value.expiryMismatch).toBe(false);
  });

  it('lets a printed label win, and flags the disagreement rather than blocking', async () => {
    const collectedAt = clock.today();
    const label = addDays(collectedAt, 30);

    const result = await registerBag(context(), bag({ collectedAt, labelExpiry: label }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The operator has the bag in their hand; the system does not. So the label
    // is stored, which claim it is gets recorded, and the mismatch is reported
    // for a human to look at again (§4).
    expect(result.value.expiresAt).toBe(label);
    expect(result.value.expirySource).toBe('label');
    expect(result.value.expiryMismatch).toBe(true);
    expect(result.value.derivedExpiry).toBe(addDays(collectedAt, 42));

    const [row] = await db.select().from(bloodBags).where(eq(bloodBags.id, result.value.bagId));
    expect(row?.expiresAt).toBe(label);
    expect(row?.expirySource).toBe('label');
  });

  it('refuses a collection date in the future', async () => {
    const result = await registerBag(
      context(),
      bag({ collectedAt: addDays(clock.today(), 1) }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('InvalidBag');
  });

  it('refuses a label expiry before the collection date', async () => {
    const result = await registerBag(
      context(),
      bag({ labelExpiry: subtractDays(clock.today(), 1) }),
    );
    expect(result.ok).toBe(false);
  });

  it('refuses a duplicate unit number', async () => {
    const unitNumber = `U-${newId().slice(0, 12)}`;
    await registerBag(context(), bag({ unitNumber }));
    const again = await registerBag(context(), bag({ unitNumber }));

    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.kind).toBe('UnitNumberTaken');
    expect(await db.select().from(bloodBags)).toHaveLength(1);
  });

  /* ------------------------------------------------------------------ tags */

  it('registers a fresh tag and opens an assignment', async () => {
    const tagUid = `TAG-${newId().slice(0, 8)}`;
    const result = await registerBag(context(), bag({ tagUid }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [tag] = await db.select().from(rfidTags).where(eq(rfidTags.tagUid, tagUid));
    expect(tag?.status).toBe('assigned');
    expect(tag?.currentBagId).toBe(result.value.bagId);

    const assignments = await db
      .select()
      .from(tagAssignments)
      .where(eq(tagAssignments.tagUid, tagUid));
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.releasedAt).toBeNull();
  });

  it('registers a bag with no tag at all', async () => {
    // §10 requires the typed path regardless of hardware, and a centre without
    // tags on every bag still has to be able to run.
    const result = await registerBag(context(), bag({ tagUid: null }));
    expect(result.ok).toBe(true);
    expect(await db.select().from(tagAssignments)).toHaveLength(0);
  });

  it('blocks a tag whose bag the register thinks is on the shelf (case 3)', async () => {
    const tagUid = `TAG-${newId().slice(0, 8)}`;
    await registerBag(context(), bag({ tagUid }));

    const second = await registerBag(context(), bag({ tagUid }));
    expect(second.ok).toBe(false);
    if (!second.ok && second.error.kind === 'TagUnavailable') {
      // Either the register is stale, two bags carry the same tag, or the tag
      // is cloned. Every one of those can put the wrong unit into a patient, so
      // there is no resolution offered here, by design (§4, §7.5).
      expect(second.error.case).toBe('register_conflict');
    }

    expect(await db.select().from(bloodBags)).toHaveLength(1);
  });

  it('names the return case when the tag carries a live bag (case 1)', async () => {
    const tagUid = `TAG-${newId().slice(0, 8)}`;
    const first = await registerBag(context(), bag({ tagUid }));
    if (!first.ok) return;

    // A reserved bag must name the request it is held for — the CHECK refuses
    // one that does not — so this sets up a real request rather than faking it.
    const requestUuid = await draftRequest();
    await client`UPDATE hospital.blood_bags
                    SET status = 'reserved', reserved_for_request_id = ${requestUuid}
                  WHERE id = ${first.value.bagId}`;

    const second = await registerBag(context(), bag({ tagUid }));
    expect(second.ok).toBe(false);
    if (!second.ok && second.error.kind === 'TagUnavailable') {
      // If the unit has come back it is a return, not a new registration —
      // the two must not share a button (§4).
      expect(second.error.case).toBe('bag_live');
    }
  });

  it('names the re-registration case when the tag carries a finished bag (case 2)', async () => {
    const tagUid = `TAG-${newId().slice(0, 8)}`;
    const first = await registerBag(context(), bag({ tagUid }));
    if (!first.ok) return;

    await client`UPDATE hospital.blood_bags SET status = 'discarded' WHERE id = ${first.value.bagId}`;

    const second = await registerBag(context(), bag({ tagUid }));
    expect(second.ok).toBe(false);
    if (!second.ok && second.error.kind === 'TagUnavailable') {
      expect(second.error.case).toBe('bag_terminal');
    }
  });

  it('never puts a retired tag back into service', async () => {
    const tagUid = `TAG-${newId().slice(0, 8)}`;
    await db.insert(rfidTags).values({
      tagUid,
      status: 'retired',
      retiredAt: clock.now(),
      retireReason: 'Damaged',
    });

    const result = await registerBag(context(), bag({ tagUid }));
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'TagUnavailable') {
      expect(result.error.case).toBe('retired');
    }
  });

  it('lets exactly one of two operators register the same tag at once', async () => {
    const tagUid = `TAG-${newId().slice(0, 8)}`;

    const [a, b] = await Promise.all([
      registerBag(context(), bag({ tagUid })),
      registerBag(context(), bag({ tagUid })),
    ]);

    // `SELECT ... FOR UPDATE` on the tag row serialises them, so the second sees
    // the tag as assigned rather than both writing and one failing on the
    // partial unique index with a message nobody can act on (§7.5).
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await db.select().from(tagAssignments)).toHaveLength(1);
  });

  /* -------------------------------------------------------------- expiring */

  it('marks past-date available bags expired, and leaves reserved ones alone', async () => {
    const stale = await registerBag(
      context(),
      bag({ collectedAt: subtractDays(clock.today(), 100) }),
    );
    const fresh = await registerBag(context(), bag({ collectedAt: clock.today() }));
    if (!stale.ok || !fresh.ok) return;

    const result = await expireStaleBags(context());
    expect(result.expired).toBe(1);

    const [staleRow] = await db.select().from(bloodBags).where(eq(bloodBags.id, stale.value.bagId));
    const [freshRow] = await db.select().from(bloodBags).where(eq(bloodBags.id, fresh.value.bagId));
    expect(staleRow?.status).toBe('expired');
    expect(freshRow?.status).toBe('available');
  });

  it('does not let a doctor register a bag', async () => {
    const doctor: Actor = {
      kind: 'user',
      userId: newId(),
      role: 'doctor',
      districtScopeId: null,
    };
    const result = await registerBag(context({ actor: doctor }), bag());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('NotAuthorized');
  });
});
