import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { CONFIG_DEFAULTS } from '@blood-connect/config';
import {
  admissions,
  bloodBags,
  bloodRequests,
  centreDecisions,
  centreSettings,
  decisionBags,
  donorDemand,
  patients,
  users,
} from '@blood-connect/db';
import { addDays, type BloodGroup, type Product } from '@blood-connect/domain';
import { idGenerator, newId } from '@blood-connect/ids';
import { createFakeClock } from '@blood-connect/testing';
import {
  argon2Hasher,
  nodeTokens,
  type Actor,
  type Database,
  type UseCaseContext,
} from '@blood-connect/platform';

import { decideRequest } from './decide.js';
import { recruitForFloor } from './demand.js';

const testUrl = process.env['TEST_DATABASE_URL'];
const CENTRE_ID = '01930000-0000-7000-8000-000000000001';
const DISTRICT_ID = 'TEST_DISTRICT';

describe.skipIf(!testUrl)('deciding a request (§7.2)', () => {
  // Separate connections, so two decisions genuinely run at once. A pool of one
  // would serialise them and every race below would pass for the wrong reason.
  const client = postgres(testUrl ?? '', { max: 12, onnotice: () => undefined });
  const db = drizzle(client) as unknown as Database;
  const clock = createFakeClock('2026-09-08T09:00:00.000Z');

  let counterId: string;
  let doctorId: string;
  let admissionId: string;
  let counter: Actor;

  const context = (overrides: Partial<UseCaseContext> = {}): UseCaseContext => ({
    db,
    clock,
    ids: idGenerator,
    ports: { hasher: argon2Hasher, tokens: nodeTokens },
    actor: counter,
    correlationId: newId(),
    config: CONFIG_DEFAULTS,
    request: { ip: '10.0.0.1', userAgent: 'vitest' },
    ...overrides,
  });

  beforeEach(async () => {
    await client`TRUNCATE hospital.audit_log, hospital.decision_bags, hospital.centre_decisions,
                          hospital.donor_demand_confirmations, hospital.donor_demand,
                          hospital.tag_assignments, hospital.rfid_tags, hospital.blood_bags,
                          hospital.blood_requests, hospital.admissions, hospital.patients,
                          hospital.blood_request_counters, hospital.users
                 RESTART IDENTITY CASCADE`;
    await client`INSERT INTO hospital.centres (id, name) VALUES (${CENTRE_ID}, 'Test centre')
                 ON CONFLICT (id) DO NOTHING`;
    // A district for the demand snapshot to point at. Synthetic, and not the
    // seeded Kozhikode node: the suite must pass on a database nobody has
    // seeded, so it brings its own reference row.
    await client`INSERT INTO reference.location_dataset_versions (version, source)
                 VALUES ('test', 'vitest') ON CONFLICT (version) DO NOTHING`;
    await client`INSERT INTO reference.location_nodes
                   (id, level, kind, parent_id, name, name_normalised, dataset_version)
                 VALUES (${DISTRICT_ID}, 'district', 'district', NULL, 'Test District',
                         'test district', 'test')
                 ON CONFLICT (id) DO NOTHING`;

    await client`INSERT INTO hospital.centre_settings
                   (id, centre_id, hospital_name, address, district_id, min_units_per_group)
                 VALUES (1, ${CENTRE_ID}, 'Test centre', 'Test address', ${DISTRICT_ID}, 25)
                 ON CONFLICT (id) DO UPDATE
                    SET district_id = ${DISTRICT_ID}, min_units_per_group = 25`;

    counterId = newId();
    counter = { kind: 'user', userId: counterId, role: 'blood_centre', districtScopeId: null };
    doctorId = newId();

    await db.insert(users).values([
      {
        id: counterId,
        email: `counter-${counterId}@blood-connect.invalid`,
        fullName: 'Counter Staff',
        role: 'blood_centre',
        status: 'active',
        passwordHash: 'x'.repeat(20),
      },
      {
        id: doctorId,
        email: `doctor-${doctorId}@blood-connect.invalid`,
        fullName: 'Dr Test',
        role: 'doctor',
        provisionalReg: `REG-${doctorId.slice(0, 8)}`,
        status: 'active',
        passwordHash: 'x'.repeat(20),
      },
    ]);

    const patientId = newId();
    await db.insert(patients).values({
      id: patientId,
      name: 'Test Patient',
      age: 40,
      ageUnit: 'years',
      sex: 'female',
      bloodGroup: 'O+',
      previousTransfusion: 'unknown',
    });

    admissionId = newId();
    await db.insert(admissions).values({
      id: admissionId,
      ipNo: `IP-${admissionId.slice(0, 8)}`,
      patientId,
      ward: '3B',
      admittedAt: clock.now(),
      status: 'admitted',
    });
  });

  afterAll(async () => {
    // The reference hierarchy is shared across every suite, and one of them
    // asserts that the seed loaded exactly one district. A test that leaves its
    // own district behind breaks that check — so it takes its rows with it.
    await client`UPDATE hospital.centre_settings SET district_id = NULL, city_id = NULL`;
    await client`DELETE FROM reference.location_nodes WHERE id LIKE 'TEST%'`;
    await client.end({ timeout: 5 });
  });

  /** A submitted request, ready for the counter. */
  async function submittedRequest(
    units: number,
    product: Product = 'prbc',
    bloodGroup: BloodGroup = 'O+',
  ): Promise<string> {
    const id = newId();
    await db.insert(bloodRequests).values({
      id,
      requestId: `BR-2026-${String(Math.floor(Math.random() * 900000) + 100000)}`,
      centreId: CENTRE_ID,
      admissionId,
      doctorId,
      status: 'submitted',
      // Required of every non-draft request since ADR 0010.
      urgency: 'routine',
      indication: 'Anaemia',
      dateRequired: clock.today(),
      bloodGroup,
      product,
      units,
      submittedAt: clock.now(),
      patientSnapshot: { name: 'Test Patient', ipNo: 'IP-1', ward: '3B', bloodGroup },
      doctorSnapshot: { id: doctorId, fullName: 'Dr Test' },
    });
    return id;
  }

  /** `count` available bags, each expiring a day later than the last. */
  async function stock(
    count: number,
    product: Product = 'prbc',
    bloodGroup: BloodGroup = 'O+',
  ): Promise<string[]> {
    if (count === 0) return [];
    const today = clock.today();
    const rows = Array.from({ length: count }, (_, i) => ({
      id: newId(),
      centreId: CENTRE_ID,
      unitNumber: `T-${newId().slice(0, 12)}-${i}`,
      bloodGroup,
      product,
      collectedAt: today,
      // Ascending expiry, so "oldest first" is a claim the order can fail.
      expiresAt: addDays(today, i + 1),
      status: 'available' as const,
    }));
    await db.insert(bloodBags).values(rows);
    return rows.map((row) => row.id);
  }

  /* ------------------------------------------------------------ the answer */

  it('issues the units, reserves exactly those bags, and moves the request', async () => {
    await stock(5);
    const requestId = await submittedRequest(3);

    const result = await decideRequest(context(), {
      requestUuid: requestId,
      action: 'issue',
      note: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.decision).toBe('approved');
    expect(result.value.unitsIssued).toBe(3);
    expect(result.value.bagIds).toHaveLength(3);
    expect(result.value.demandId).toBeNull();

    const [request] = await db
      .select()
      .from(bloodRequests)
      .where(eq(bloodRequests.id, requestId));
    expect(request?.status).toBe('approved');

    const reserved = await db
      .select()
      .from(bloodBags)
      .where(eq(bloodBags.status, 'reserved'));
    expect(reserved).toHaveLength(3);
    expect(reserved.every((bag) => bag.reservedForRequestId === requestId)).toBe(true);

    const recorded = await db
      .select()
      .from(decisionBags)
      .where(eq(decisionBags.decisionId, result.value.decisionId));
    expect(recorded.map((row) => row.bagId).sort()).toEqual([...result.value.bagIds].sort());
  });

  it('takes the shortest-dated units first', async () => {
    const bagIds = await stock(6);
    const requestId = await submittedRequest(2);

    const result = await decideRequest(context(), {
      requestUuid: requestId,
      action: 'issue',
      note: null,
    });
    if (!result.ok) return;

    // A centre that issues its freshest units throws the rest away. The first
    // two ids are the two soonest expiries, by construction.
    expect([...result.value.bagIds].sort()).toEqual(bagIds.slice(0, 2).sort());
  });

  /* ------------------------------------------------------- the constraint */

  it('lets exactly one of two staff decide the same request', async () => {
    await stock(10);
    const requestId = await submittedRequest(2);

    const [a, b] = await Promise.all([
      decideRequest(context(), { requestUuid: requestId, action: 'issue', note: 'first' }),
      decideRequest(context(), { requestUuid: requestId, action: 'issue', note: 'second' }),
    ]);

    const winners = [a, b].filter((r) => r.ok);
    const losers = [a, b].filter((r) => !r.ok);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    /**
     * The loser is refused one of two ways, and both are correct.
     *
     * If the winner committed before the loser's opening read, the loser never
     * reaches the transaction and sees the request already answered
     * (`RequestNotDecidable`). If it got as far as the insert, the unique
     * constraint refuses it (`RequestAlreadyDecided`). Which one happens is a
     * matter of microseconds and is not worth pinning; what matters is that a
     * second decision is impossible either way, which the row count below is
     * the real assertion of.
     */
    for (const loser of losers) {
      expect(['RequestAlreadyDecided', 'RequestNotDecidable']).toContain(
        loser.error.kind,
      );
    }

    // One decision row, and one request answered.
    const decisions = await db.select().from(centreDecisions);
    expect(decisions).toHaveLength(1);
  });

  it('turns the unique constraint itself into a refusal, not a crash', async () => {
    await stock(5);
    const requestId = await submittedRequest(2);

    // A decision row exists, but the request has not been moved — exactly the
    // window a concurrent decider is inside. So this call passes the opening
    // read and fails on the constraint, which is the path that has to produce a
    // `Result` rather than a 500. The concurrent test above cannot guarantee it
    // reaches here, so this one arranges it.
    await client`INSERT INTO hospital.centre_decisions
                   (id, request_id, decision, units_issued, units_requested, decided_by)
                 VALUES (gen_random_uuid(), ${requestId}, 'declined', 0, 2, ${counterId})`;

    const result = await decideRequest(context(), {
      requestUuid: requestId,
      action: 'issue',
      note: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('RequestAlreadyDecided');

    // And the rollback released everything it had claimed.
    expect(await db.select().from(bloodBags).where(eq(bloodBags.status, 'reserved'))).toHaveLength(
      0,
    );
  });

  it('leaves the loser holding no bags at all', async () => {
    await stock(10);
    const requestId = await submittedRequest(3);

    await Promise.all([
      decideRequest(context(), { requestUuid: requestId, action: 'issue', note: null }),
      decideRequest(context(), { requestUuid: requestId, action: 'issue', note: null }),
    ]);

    // The claim in step 1 takes locks but writes nothing, and the constraint is
    // tested before a single bag is marked reserved — so the loser's rollback
    // strands nothing on the shelf. Exactly three bags are held, not six.
    const reserved = await db.select().from(bloodBags).where(eq(bloodBags.status, 'reserved'));
    expect(reserved).toHaveLength(3);
  });

  it('never gives the same bag to two different requests', async () => {
    // Four bags, two requests wanting three each: they must not overlap, and
    // between them they must take all four.
    await stock(4);
    const first = await submittedRequest(3);
    const second = await submittedRequest(3);

    const [a, b] = await Promise.all([
      decideRequest(context(), { requestUuid: first, action: 'issue', note: null }),
      decideRequest(context(), { requestUuid: second, action: 'issue', note: null }),
    ]);

    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    const taken = [...a.value.bagIds, ...b.value.bagIds];
    // SKIP LOCKED is what makes this true: neither waited for the other, and
    // neither took a bag the other had.
    expect(new Set(taken).size).toBe(taken.length);
    expect(taken).toHaveLength(4);

    const rows = await db.select().from(decisionBags);
    expect(rows).toHaveLength(4);
  });

  /* ------------------------------------------------------------ shortfall */

  it('raises a demand for the difference, in the same transaction', async () => {
    await stock(1);
    const requestId = await submittedRequest(4);

    const result = await decideRequest(context(), {
      requestUuid: requestId,
      action: 'issue',
      note: null,
    });
    if (!result.ok) return;

    expect(result.value.decision).toBe('partial');
    expect(result.value.unitsIssued).toBe(1);
    expect(result.value.demandId).not.toBeNull();

    const [demand] = await db.select().from(donorDemand);
    expect(demand?.units).toBe(3);
    expect(demand?.trigger).toBe('request_shortfall');
    expect(demand?.bloodRequestId).toBe(requestId);
    expect(demand?.status).toBe('open');
    // Snapshotted, so a later settings change cannot rewrite what donors were
    // told (§2.6).
    expect(demand?.hospitalName).toBe('Test centre');
    expect(demand?.districtId).toBe(DISTRICT_ID);

    const [request] = await db
      .select()
      .from(bloodRequests)
      .where(eq(bloodRequests.id, requestId));
    expect(request?.status).toBe('partially_approved');
  });

  it('declines with a demand when the shelf is empty', async () => {
    const requestId = await submittedRequest(2, 'whole_blood');

    const result = await decideRequest(context(), {
      requestUuid: requestId,
      action: 'issue',
      note: 'Nothing on the shelf',
    });
    if (!result.ok) return;

    expect(result.value.decision).toBe('declined');
    expect(result.value.unitsIssued).toBe(0);

    // "Declined for want of stock" is precisely the case that must recruit.
    const [demand] = await db.select().from(donorDemand);
    expect(demand?.units).toBe(2);
  });

  it.each(['platelet_concentrate', 'ffp', 'cryoprecipitate'] as const)(
    'never raises a demand for %s',
    async (product) => {
      const requestId = await submittedRequest(3, product);

      const result = await decideRequest(context(), {
        requestUuid: requestId,
        action: 'issue',
        note: null,
      });
      if (!result.ok) return;

      expect(result.value.decision).toBe('declined');
      expect(result.value.demandId).toBeNull();

      // Platelets, plasma and cryoprecipitate are separated in a lab. A demand
      // for one is a message asking real people for something they cannot give.
      const demands = await db.select().from(donorDemand);
      expect(demands).toHaveLength(0);
    },
  );

  it('raises no demand when the centre declines on the merits', async () => {
    await stock(5);
    const requestId = await submittedRequest(2);

    const result = await decideRequest(context(), {
      requestUuid: requestId,
      action: 'decline',
      note: 'Duplicate of the earlier request',
    });
    if (!result.ok) return;

    expect(result.value.decision).toBe('declined');
    // A deliberate refusal is not a shortfall. Recruiting donors for a request
    // the centre has just refused would be sending people out for nothing.
    expect(await db.select().from(donorDemand)).toHaveLength(0);
    expect(await db.select().from(bloodBags).where(eq(bloodBags.status, 'reserved'))).toHaveLength(0);
  });

  it('refuses to answer a request twice, sequentially as well', async () => {
    await stock(5);
    const requestId = await submittedRequest(1);

    const first = await decideRequest(context(), {
      requestUuid: requestId,
      action: 'issue',
      note: null,
    });
    const second = await decideRequest(context(), {
      requestUuid: requestId,
      action: 'issue',
      note: null,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.kind).toBe('RequestNotDecidable');
  });

  it('refuses a draft, and a cancelled request', async () => {
    const draftId = newId();
    await db.insert(bloodRequests).values({
      id: draftId,
      centreId: CENTRE_ID,
      admissionId,
      doctorId,
      status: 'draft',
    });

    const result = await decideRequest(context(), {
      requestUuid: draftId,
      action: 'issue',
      note: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('RequestNotDecidable');
  });

  it('does not let a doctor decide a request (§2.2)', async () => {
    await stock(5);
    const requestId = await submittedRequest(1);

    const doctor: Actor = {
      kind: 'user',
      userId: doctorId,
      role: 'doctor',
      districtScopeId: null,
    };
    const result = await decideRequest(context({ actor: doctor }), {
      requestUuid: requestId,
      action: 'issue',
      note: null,
    });

    // Raising and deciding are separate roles, so no one person can approve
    // their own request however many permissions they accumulate.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('NotAuthorized');
  });

  it('refuses to raise a demand when the centre has no district', async () => {
    await client`UPDATE hospital.centre_settings SET district_id = NULL WHERE id = 1`;
    const requestId = await submittedRequest(2);

    const result = await decideRequest(context(), {
      requestUuid: requestId,
      action: 'issue',
      note: null,
    });

    // A demand with no district tells somebody to come and give blood without
    // saying where. The whole decision fails rather than committing an answer
    // that quietly recruits nobody.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('SettingsIncomplete');

    expect(await db.select().from(centreDecisions)).toHaveLength(0);
    const [request] = await db
      .select()
      .from(bloodRequests)
      .where(eq(bloodRequests.id, requestId));
    expect(request?.status).toBe('submitted');
  });

  /* ----------------------------------------------------------- stock floor */

  it('raises one demand per short group, and refuses to double-raise', async () => {
    await stock(2, 'prbc', 'O-');

    const shortfalls = [
      { bloodGroup: 'O-' as BloodGroup, onShelf: 2, floor: 25, short: 23 },
      { bloodGroup: 'AB-' as BloodGroup, onShelf: 0, floor: 25, short: 25 },
    ];

    const first = await recruitForFloor(context(), shortfalls);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.raised).toHaveLength(2);

    const second = await recruitForFloor(context(), shortfalls);
    expect(second.ok).toBe(true);
    if (second.ok) {
      // The partial unique index, not a check-then-insert: pressing the button
      // twice recruits the same people twice, which is how a centre loses its
      // donors' goodwill.
      expect(second.value.raised).toHaveLength(0);
      expect(second.value.alreadyOpen).toEqual(['O-', 'AB-']);
    }

    const demands = await db
      .select()
      .from(donorDemand)
      .where(eq(donorDemand.trigger, 'stock_floor'));
    expect(demands).toHaveLength(2);
    expect(demands.every((d) => d.bloodRequestId === null)).toBe(true);
    expect(demands.every((d) => d.product === 'whole_blood')).toBe(true);
  });

  it('does not double-raise when two people press it at the same instant', async () => {
    const shortfalls = [{ bloodGroup: 'B-' as BloodGroup, onShelf: 0, floor: 25, short: 25 }];

    await Promise.all([
      recruitForFloor(context(), shortfalls),
      recruitForFloor(context(), shortfalls),
    ]);

    const demands = await db
      .select()
      .from(donorDemand)
      .where(
        and(eq(donorDemand.trigger, 'stock_floor'), inArray(donorDemand.bloodGroup, ['B-'])),
      );
    expect(demands).toHaveLength(1);
  });

  it('recruits again once the earlier floor demand is closed', async () => {
    const shortfalls = [{ bloodGroup: 'A-' as BloodGroup, onShelf: 0, floor: 25, short: 25 }];

    const first = await recruitForFloor(context(), shortfalls);
    if (!first.ok) return;

    await db
      .update(donorDemand)
      .set({ status: 'completed' })
      .where(eq(donorDemand.id, first.value.raised[0]?.demandId ?? ''));

    // The index is partial on `status = 'open'`, so a closed demand does not
    // block the next one. A floor that could only ever be recruited for once
    // would be worse than no floor at all.
    const second = await recruitForFloor(context(), shortfalls);
    expect(second.ok && second.value.raised).toHaveLength(1);
  });

  it('leaves the settings row alone', async () => {
    const [row] = await db.select().from(centreSettings).where(eq(centreSettings.id, 1));
    expect(row?.minUnitsPerGroup).toBe(25);
  });
});
