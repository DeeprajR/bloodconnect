import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { CONFIG_DEFAULTS } from '@blood-connect/config';
import {
  admissions,
  bloodRequestCounters,
  bloodRequests,
  patients,
  users,
} from '@blood-connect/db';
import { parseRequestNumber } from '@blood-connect/domain';
import { idGenerator, newId } from '@blood-connect/ids';
import { createFakeClock } from '@blood-connect/testing';
import {
  argon2Hasher,
  nodeTokens,
  type Actor,
  type Database,
  type UseCaseContext,
} from '@blood-connect/platform';

import { createDraft, updateDraft } from './records.js';
import { submitRequest } from './submit.js';

const testUrl = process.env['TEST_DATABASE_URL'];
const CENTRE_ID = '01930000-0000-7000-8000-000000000001';

describe.skipIf(!testUrl)('submitting a blood request (§7.1)', () => {
  const client = postgres(testUrl ?? '', { max: 8, onnotice: () => undefined });
  const db = drizzle(client) as unknown as Database;
  const clock = createFakeClock('2026-09-08T09:00:00.000Z');

  let doctorId: string;
  let admissionId: string;
  let doctor: Actor;

  const context = (overrides: Partial<UseCaseContext> = {}): UseCaseContext => ({
    db,
    clock,
    ids: idGenerator,
    ports: { hasher: argon2Hasher, tokens: nodeTokens },
    actor: doctor,
    correlationId: newId(),
    config: CONFIG_DEFAULTS,
    request: { ip: '10.0.0.1', userAgent: 'vitest' },
    ...overrides,
  });

  beforeEach(async () => {
    await client`TRUNCATE hospital.audit_log, hospital.blood_requests, hospital.admissions,
                          hospital.patients, hospital.blood_request_counters, hospital.users
                 RESTART IDENTITY CASCADE`;
    await client`INSERT INTO hospital.centres (id, name) VALUES (${CENTRE_ID}, 'Test centre')
                 ON CONFLICT (id) DO NOTHING`;

    doctorId = newId();
    doctor = { kind: 'user', userId: doctorId, role: 'doctor', districtScopeId: null };

    await db.insert(users).values({
      id: doctorId,
      email: `doctor-${doctorId}@blood-connect.invalid`,
      fullName: 'Dr Test',
      role: 'doctor',
      provisionalReg: `REG-${doctorId.slice(0, 8)}`,
      status: 'active',
      passwordHash: 'x'.repeat(20),
    });

    const patientId = newId();
    await db.insert(patients).values({
      id: patientId,
      name: 'Test Patient',
      age: 34,
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
      ward: '3B',
      admittedAt: clock.now(),
      status: 'admitted',
    });
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  /** A complete draft, ready to submit. */
  async function readyDraft(): Promise<string> {
    const created = await createDraft(context(), admissionId);
    if (!created.ok) throw new Error('could not create a draft');

    const updated = await updateDraft(context(), created.value.requestUuid, {
      indication: 'Post-operative anaemia',
      dateRequired: clock.today(),
      bloodGroup: 'O+',
      product: 'prbc',
      units: 2,
    });
    if (!updated.ok) throw new Error('could not complete the draft');

    return created.value.requestUuid;
  }

  it('allocates an identifier and freezes both snapshots (§2.6)', async () => {
    const id = await readyDraft();
    const result = await submitRequest(context(), id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.requestId).toBe('BR-2026-000001');

    const [row] = await db.select().from(bloodRequests).where(eq(bloodRequests.id, id));
    expect(row?.status).toBe('submitted');
    expect(row?.submittedAt).not.toBeNull();

    const patient = row?.patientSnapshot as Record<string, unknown>;
    const doc = row?.doctorSnapshot as Record<string, unknown>;
    expect(patient['name']).toBe('Test Patient');
    expect(patient['ipNo']).toBe(`IP-${admissionId.slice(0, 8)}`);
    expect(doc['fullName']).toBe('Dr Test');
  });

  it('keeps the snapshot when the patient record later changes (§2.6)', async () => {
    const id = await readyDraft();
    await submitRequest(context(), id);

    const [before] = await db.select().from(bloodRequests).where(eq(bloodRequests.id, id));
    const admissionRow = await db
      .select({ patientId: admissions.patientId })
      .from(admissions)
      .where(eq(admissions.id, admissionId));

    await db
      .update(patients)
      .set({ name: 'Corrected Name' })
      .where(eq(patients.id, admissionRow[0]?.patientId ?? ''));

    const [after] = await db.select().from(bloodRequests).where(eq(bloodRequests.id, id));

    // A request is a record of what was asked for. Editing the patient a month
    // later must not rewrite what the centre was told.
    expect((after?.patientSnapshot as Record<string, unknown>)['name']).toBe('Test Patient');
    expect(after?.patientSnapshot).toEqual(before?.patientSnapshot);
  });

  /* ------------------------------------------------------------------ §7.1 */

  it('gives two concurrent submits consecutive numbers, with no gap', async () => {
    const first = await readyDraft();
    const second = await readyDraft();

    // Genuinely at the same time: the pool hands these separate connections, so
    // the counter row is the only thing ordering them.
    const [a, b] = await Promise.all([
      submitRequest(context(), first),
      submitRequest(context(), second),
    ]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    const numbers = [a.value.sequence, b.value.sequence].sort((x, y) => x - y);
    expect(numbers).toEqual([1, 2]);

    const [counter] = await db
      .select()
      .from(bloodRequestCounters)
      .where(eq(bloodRequestCounters.year, 2026));
    expect(counter?.nextValue).toBe(3);
  });

  it('leaves no gap across many concurrent submits', async () => {
    const drafts = await Promise.all(Array.from({ length: 8 }, () => readyDraft()));
    const results = await Promise.all(drafts.map((id) => submitRequest(context(), id)));

    const sequences = results
      .flatMap((r) => (r.ok ? [r.value.sequence] : []))
      .sort((a, b) => a - b);

    // A hole in a clinical record series looks exactly like a deleted request,
    // which is why the counter shares the submit transaction.
    expect(sequences).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(sequences).size).toBe(8);
  });

  it('burns no number when a submit fails', async () => {
    const good = await readyDraft();
    await submitRequest(context(), good);

    // An incomplete draft is refused after the counter would have been read.
    const incomplete = await createDraft(context(), admissionId);
    if (!incomplete.ok) throw new Error('no draft');
    const refused = await submitRequest(context(), incomplete.value.requestUuid);
    expect(refused.ok).toBe(false);

    const next = await readyDraft();
    const after = await submitRequest(context(), next);
    expect(after.ok && after.value.sequence).toBe(2);
  });

  it('formats the identifier as BR-YYYY-NNNNNN', async () => {
    const id = await readyDraft();
    const result = await submitRequest(context(), id);
    if (!result.ok) return;

    expect(parseRequestNumber(result.value.requestId)).toEqual({ year: 2026, sequence: 1 });
  });

  /* ------------------------------------------------------------------ §8.2 */

  it('refuses every draft endpoint once submitted', async () => {
    const id = await readyDraft();
    await submitRequest(context(), id);

    const edit = await updateDraft(context(), id, {
      indication: 'Changed after the fact',
      dateRequired: clock.today(),
      bloodGroup: 'A+',
      product: 'ffp',
      units: 9,
    });

    expect(edit.ok).toBe(false);
    if (!edit.ok) expect(edit.error.kind).toBe('RequestNotADraft');

    // And nothing moved.
    const [row] = await db.select().from(bloodRequests).where(eq(bloodRequests.id, id));
    expect(row?.indication).toBe('Post-operative anaemia');
    expect(row?.units).toBe(2);
  });

  it('submits a draft once, and the second attempt changes nothing', async () => {
    const id = await readyDraft();
    const first = await submitRequest(context(), id);
    const second = await submitRequest(context(), id);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.kind).toBe('RequestNotADraft');

    const [counter] = await db
      .select()
      .from(bloodRequestCounters)
      .where(eq(bloodRequestCounters.year, 2026));
    // The refused attempt must not have consumed a number.
    expect(counter?.nextValue).toBe(2);
  });

  it('refuses an incomplete draft and says what is missing', async () => {
    const created = await createDraft(context(), admissionId);
    if (!created.ok) throw new Error('no draft');

    await db
      .update(bloodRequests)
      .set({ indication: null })
      .where(eq(bloodRequests.id, created.value.requestUuid));

    const result = await submitRequest(context(), created.value.requestUuid);
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'IncompleteDraft') {
      expect(result.error.missing).toContain('indication');
    }
  });

  it('does not let one doctor submit another’s draft', async () => {
    const id = await readyDraft();

    const stranger: Actor = {
      kind: 'user',
      userId: newId(),
      role: 'doctor',
      districtScopeId: null,
    };
    const result = await submitRequest(context({ actor: stranger }), id);

    // The doctor snapshot comes from the session, so submitting someone else's
    // draft would attribute it to the wrong clinician.
    expect(result.ok).toBe(false);
  });

  it('does not let the blood centre raise a request at all (§2.2)', async () => {
    const id = await readyDraft();
    const centre: Actor = {
      kind: 'user',
      userId: newId(),
      role: 'blood_centre',
      districtScopeId: null,
    };

    const result = await submitRequest(context({ actor: centre }), id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('NotAuthorized');
  });
});
