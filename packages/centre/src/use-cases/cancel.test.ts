import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { CONFIG_DEFAULTS } from '@blood-connect/config';
import {
  admissions,
  bloodBags,
  bloodRequests,
  donorDemand,
  patients,
  users,
} from '@blood-connect/db';
import { addDays, bloodRequestTransitions, canTransition } from '@blood-connect/domain';
import { idGenerator, newId } from '@blood-connect/ids';
import { createFakeClock } from '@blood-connect/testing';
import {
  argon2Hasher,
  nodeTokens,
  type Actor,
  type Database,
  type UseCaseContext,
} from '@blood-connect/platform';

import { cancelRequest } from './cancel.js';
import { decideRequest } from './decide.js';

const testUrl = process.env['TEST_DATABASE_URL'];
const CENTRE_ID = '01930000-0000-7000-8000-000000000001';
const DISTRICT_ID = 'TEST_CANCEL_DISTRICT';

/**
 * Cancelling a request (§3, §8).
 *
 * The doctor's one post-submit action, and §14 names what it prevents as the
 * failure this system most has to avoid: a confirmed donor travelling to a
 * hospital that no longer needs them.
 *
 * Three modules' tables have to move together, so every test below asserts all
 * three — a request showing cancelled while units stay held for it, or while
 * donors are still being recruited, is worse than not cancelling at all.
 */
describe.skipIf(!testUrl)('cancelling a request (§3, §8)', () => {
  const client = postgres(testUrl ?? '', { max: 8, onnotice: () => undefined });
  const db = drizzle(client) as unknown as Database;
  const clock = createFakeClock('2026-09-09T09:00:00.000Z');

  let doctorId: string;
  let counterId: string;
  let admissionId: string;
  let doctor: Actor;
  let counter: Actor;

  const context = (actor: Actor): UseCaseContext => ({
    db,
    clock,
    ids: idGenerator,
    ports: { hasher: argon2Hasher, tokens: nodeTokens },
    actor,
    correlationId: newId(),
    config: CONFIG_DEFAULTS,
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
    await client`INSERT INTO reference.location_dataset_versions (version, source)
                 VALUES ('test', 'vitest') ON CONFLICT (version) DO NOTHING`;
    await client`INSERT INTO reference.location_nodes
                   (id, level, kind, parent_id, name, name_normalised, dataset_version)
                 VALUES (${DISTRICT_ID}, 'district', 'district', NULL, 'Cancel District',
                         'cancel district', 'test')
                 ON CONFLICT (id) DO NOTHING`;
    await client`INSERT INTO hospital.centre_settings
                   (id, centre_id, hospital_name, address, district_id, min_units_per_group)
                 VALUES (1, ${CENTRE_ID}, 'Test centre', 'Test address', ${DISTRICT_ID}, 25)
                 ON CONFLICT (id) DO UPDATE SET district_id = ${DISTRICT_ID}`;

    doctorId = newId();
    counterId = newId();
    doctor = { kind: 'user', userId: doctorId, role: 'doctor', districtScopeId: null };
    counter = { kind: 'user', userId: counterId, role: 'blood_centre', districtScopeId: null };

    await db.insert(users).values([
      {
        id: doctorId,
        email: `doctor-${doctorId}@blood-connect.invalid`,
        fullName: 'Dr Test',
        role: 'doctor',
        status: 'active',
        passwordHash: 'x'.repeat(20),
      },
      {
        id: counterId,
        email: `counter-${counterId}@blood-connect.invalid`,
        fullName: 'Counter Staff',
        role: 'blood_centre',
        status: 'active',
        passwordHash: 'x'.repeat(20),
      },
    ]);

    const patientId = newId();
    await db.insert(patients).values({
      id: patientId,
      name: 'Test Patient',
      age: 30,
      ageUnit: 'years',
      sex: 'male',
      bloodGroup: 'O+',
      previousTransfusion: 'unknown',
    });

    admissionId = newId();
    await db.insert(admissions).values({
      id: admissionId,
      ipNo: `IP-${admissionId.slice(0, 8)}`,
      patientId,
      ward: '4A',
      admittedAt: clock.now(),
      status: 'admitted',
    });
  });

  afterAll(async () => {
    // The settings row points at this district, and the foreign key is the
    // point rather than an obstacle — so it is released before the node goes.
    await client`UPDATE hospital.centre_settings SET district_id = NULL, city_id = NULL`;
    await client`DELETE FROM reference.location_nodes WHERE id LIKE 'TEST%'`;
    await client.end({ timeout: 5 });
  });

  async function submitted(units = 2): Promise<string> {
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
      dateRequired: addDays(clock.today(), 2),
      bloodGroup: 'O+',
      product: 'whole_blood',
      units,
      submittedAt: clock.now(),
      patientSnapshot: { name: 'Test Patient', ipNo: 'IP-1', ward: '4A', bloodGroup: 'O+' },
      doctorSnapshot: { id: doctorId, fullName: 'Dr Test' },
    });
    return id;
  }

  async function stock(count: number): Promise<void> {
    if (count === 0) return;
    await db.insert(bloodBags).values(
      Array.from({ length: count }, (_, i) => ({
        id: newId(),
        centreId: CENTRE_ID,
        unitNumber: `C-${newId().slice(0, 12)}-${i}`,
        bloodGroup: 'O+',
        product: 'whole_blood' as const,
        collectedAt: clock.today(),
        expiresAt: addDays(clock.today(), i + 5),
        status: 'available' as const,
      })),
    );
  }

  /* ------------------------------------------------------ before a decision */

  it('cancels a submitted request with a reason', async () => {
    const id = await submitted();

    const result = await cancelRequest(context(doctor), id, 'Patient improved');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.cancelledFrom).toBe('submitted');
    expect(result.value.bagsReleased).toBe(0);

    const [row] = await db.select().from(bloodRequests).where(eq(bloodRequests.id, id));
    expect(row?.status).toBe('cancelled');
    expect(row?.cancelReason).toBe('Patient improved');
    expect(row?.cancelledAt).not.toBeNull();
  });

  it('refuses a cancellation with no reason', async () => {
    const id = await submitted();

    // §3 requires one, and this is why: the centre may already have pulled
    // units, and donors may already have agreed to come.
    const result = await cancelRequest(context(doctor), id, '   ');
    expect(result.ok).toBe(false);

    const [row] = await db.select().from(bloodRequests).where(eq(bloodRequests.id, id));
    expect(row?.status).toBe('submitted');
  });

  it('does not let another doctor cancel it', async () => {
    const id = await submitted();
    const stranger: Actor = {
      kind: 'user',
      userId: newId(),
      role: 'doctor',
      districtScopeId: null,
    };

    const result = await cancelRequest(context(stranger), id, 'Not mine to cancel');
    expect(result.ok).toBe(false);
  });

  it('does not let the centre cancel a ward’s request (§9)', async () => {
    const id = await submitted();

    const result = await cancelRequest(context(counter), id, 'Tidying the queue');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('NotAuthorized');
  });

  it('is idempotent — a second cancellation changes nothing', async () => {
    const id = await submitted();

    const first = await cancelRequest(context(doctor), id, 'Referred elsewhere');
    const second = await cancelRequest(context(doctor), id, 'Referred again');

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);

    const [row] = await db.select().from(bloodRequests).where(eq(bloodRequests.id, id));
    // The first reason stands. A second cancellation must not rewrite it.
    expect(row?.cancelReason).toBe('Referred elsewhere');
  });

  /* ------------------------------------------------------- after a decision */

  it('releases the units a decision was holding', async () => {
    await stock(5);
    const id = await submitted(3);

    const decided = await decideRequest(context(counter), {
      requestUuid: id,
      action: 'issue',
      note: null,
    });
    expect(decided.ok && decided.value.unitsIssued).toBe(3);

    const result = await cancelRequest(context(doctor), id, 'Patient died');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The whole point of §3's sentence: without this the centre chases units
    // nobody needs.
    expect(result.value.cancelledFrom).toBe('approved');
    expect(result.value.bagsReleased).toBe(3);

    const held = await db.select().from(bloodBags).where(eq(bloodBags.status, 'reserved'));
    expect(held).toHaveLength(0);

    const available = await db.select().from(bloodBags).where(eq(bloodBags.status, 'available'));
    expect(available).toHaveLength(5);
    expect(available.every((bag) => bag.reservedForRequestId === null)).toBe(true);
  });

  it('withdraws the demand a shortfall raised, so donors are stood down', async () => {
    await stock(1);
    const id = await submitted(4);

    const decided = await decideRequest(context(counter), {
      requestUuid: id,
      action: 'issue',
      note: null,
    });
    expect(decided.ok && decided.value.demandId !== null).toBe(true);

    const result = await cancelRequest(context(doctor), id, 'Patient referred');
    expect(result.ok && result.value.demandsCancelled).toBe(1);

    const [demand] = await db
      .select()
      .from(donorDemand)
      .where(eq(donorDemand.bloodRequestId, id));

    // The centre sets the status and stops there. The bot's ticker sees
    // `cancelled` and runs §7.6 — which is what actually reaches the donors.
    expect(demand?.status).toBe('cancelled');
  });

  it('does not release a unit that has already left the fridge', async () => {
    await stock(2);
    const id = await submitted(2);
    await decideRequest(context(counter), { requestUuid: id, action: 'issue', note: null });

    // One unit is issued — physically collected. It is not the register's to
    // reclaim; that is a return, decided with the unit in hand (§4).
    const [firstBag] = await db.select().from(bloodBags).where(eq(bloodBags.status, 'reserved'));
    await client`UPDATE hospital.blood_bags
                    SET status = 'issued', issued_to_request_id = ${id}, issued_at = now(),
                        reserved_for_request_id = NULL
                  WHERE id = ${firstBag?.id ?? ''}`;

    const result = await cancelRequest(context(doctor), id, 'Patient improved');
    expect(result.ok && result.value.bagsReleased).toBe(1);

    const issued = await db.select().from(bloodBags).where(eq(bloodBags.status, 'issued'));
    expect(issued).toHaveLength(1);
  });

  it('cancels a partly approved request too', async () => {
    await stock(1);
    const id = await submitted(3);
    await decideRequest(context(counter), { requestUuid: id, action: 'issue', note: null });

    const result = await cancelRequest(context(doctor), id, 'No longer needed');
    expect(result.ok && result.value.cancelledFrom).toBe('partially_approved');
    expect(result.ok && result.value.bagsReleased).toBe(1);
  });

  it('refuses to cancel a request that was declined', async () => {
    const id = await submitted(2);
    await decideRequest(context(counter), { requestUuid: id, action: 'decline', note: 'Duplicate' });

    // Nothing is held and nothing is being recruited, so there is nothing to
    // release. The ward raises a new request rather than reopening this one.
    const result = await cancelRequest(context(doctor), id, 'Changed my mind');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('RequestNotDecidable');
  });

  it('refuses to cancel a draft', async () => {
    const draftId = newId();
    await db.insert(bloodRequests).values({
      id: draftId,
      centreId: CENTRE_ID,
      admissionId,
      doctorId,
      status: 'draft',
    });

    // A draft is not cancelled — it is left, and ages visibly on the dashboard
    // (§8). Cancelling one would be an ending for something that never began.
    const result = await cancelRequest(context(doctor), draftId, 'Never mind');
    expect(result.ok).toBe(false);
  });

  it('does everything or nothing when two cancellations race', async () => {
    await stock(3);
    const id = await submitted(3);
    await decideRequest(context(counter), { requestUuid: id, action: 'issue', note: null });

    const [a, b] = await Promise.all([
      cancelRequest(context(doctor), id, 'First'),
      cancelRequest(context(doctor), id, 'Second'),
    ]);

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);

    // Exactly three units back, not six and not zero.
    const available = await db.select().from(bloodBags).where(eq(bloodBags.status, 'available'));
    expect(available).toHaveLength(3);
  });

  it('records the release in the audit log, by bag (§4)', async () => {
    await stock(2);
    const id = await submitted(2);
    await decideRequest(context(counter), { requestUuid: id, action: 'issue', note: null });
    await cancelRequest(context(doctor), id, 'Patient improved');

    const [entry] = await client<{ metadata: Record<string, unknown> }[]>`
      SELECT metadata FROM hospital.audit_log
       WHERE action = 'request.cancelled' AND subject_id = ${id}
    `;

    // "Which unit was held for whom, and when did it come back" has to be
    // answerable later; a count cannot answer it.
    expect((entry?.metadata['bagsReleased'] as string[]).length).toBe(2);
    expect(entry?.metadata['reason']).toBe('Patient improved');
  });

  /* --------------------------------------------------- the transition table */

  it('agrees with the domain about which statuses may be cancelled', async () => {
    /**
     * The table said `approved: []` until this use case was written, which
     * would have made §3's "cancelling releases any reserved bags" unreachable:
     * bags are only ever reserved *by* a decision.
     */
    expect(canTransition(bloodRequestTransitions, 'submitted', 'cancelled')).toBe(true);
    expect(canTransition(bloodRequestTransitions, 'approved', 'cancelled')).toBe(true);
    expect(canTransition(bloodRequestTransitions, 'partially_approved', 'cancelled')).toBe(true);
    expect(canTransition(bloodRequestTransitions, 'declined', 'cancelled')).toBe(false);
    expect(canTransition(bloodRequestTransitions, 'draft', 'cancelled')).toBe(false);

    // And the use case refuses exactly the two the table refuses.
    const id = await submitted(1);
    await decideRequest(context(counter), { requestUuid: id, action: 'decline', note: 'x' });
    const declined = await cancelRequest(context(doctor), id, 'reason');
    expect(declined.ok).toBe(false);
  });

  it('leaves an unrelated request and its units alone', async () => {
    await stock(4);
    const mine = await submitted(2);
    const theirs = await submitted(2);
    await decideRequest(context(counter), { requestUuid: mine, action: 'issue', note: null });
    await decideRequest(context(counter), { requestUuid: theirs, action: 'issue', note: null });

    await cancelRequest(context(doctor), mine, 'Patient improved');

    const stillHeld = await db
      .select()
      .from(bloodBags)
      .where(and(eq(bloodBags.status, 'reserved'), eq(bloodBags.reservedForRequestId, theirs)));
    expect(stillHeld).toHaveLength(2);

    const [other] = await db.select().from(bloodRequests).where(eq(bloodRequests.id, theirs));
    expect(other?.status).toBe('approved');
  });
});
