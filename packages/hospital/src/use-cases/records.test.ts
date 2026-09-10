import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { CONFIG_DEFAULTS } from '@blood-connect/config';
import { admissions, bloodRequests, patients, users } from '@blood-connect/db';
import { idGenerator, newId } from '@blood-connect/ids';
import { createFakeClock } from '@blood-connect/testing';
import {
  argon2Hasher,
  nodeTokens,
  type Actor,
  type Database,
  type UseCaseContext,
} from '@blood-connect/platform';

import {
  findPossibleDuplicates,
  listSamples,
  recordSample,
} from './records.js';

const testUrl = process.env['TEST_DATABASE_URL'];

describe.skipIf(!testUrl)('the duplicate-patient warning (§3)', () => {
  const client = postgres(testUrl ?? '', { max: 4, onnotice: () => undefined });
  const db = drizzle(client) as unknown as Database;
  const clock = createFakeClock('2026-09-09T09:00:00.000Z');

  let doctor: Actor;

  const context = (): UseCaseContext => ({
    db,
    clock,
    ids: idGenerator,
    ports: { hasher: argon2Hasher, tokens: nodeTokens },
    actor: doctor,
    correlationId: newId(),
    config: CONFIG_DEFAULTS,
  });

  beforeEach(async () => {
    await client`TRUNCATE hospital.audit_log, hospital.blood_requests, hospital.admissions,
                          hospital.patients, hospital.users RESTART IDENTITY CASCADE`;

    const doctorId = newId();
    doctor = { kind: 'user', userId: doctorId, role: 'doctor', districtScopeId: null };
    await db.insert(users).values({
      id: doctorId,
      email: `doctor-${doctorId}@blood-connect.invalid`,
      fullName: 'Dr Test',
      role: 'doctor',
      status: 'active',
      passwordHash: 'x'.repeat(20),
    });
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  async function patient(name: string, uhid: string | null = null): Promise<string> {
    const id = newId();
    await db.insert(patients).values({
      id,
      name,
      age: 40,
      ageUnit: 'years',
      sex: 'female',
      bloodGroup: 'O+',
      uhid,
      previousTransfusion: 'unknown',
    });
    return id;
  }

  it('finds a name spelled slightly differently', async () => {
    await patient('Anitha Menon');

    // Human-entered names are misspelled and transliterated; an exact index
    // finds none of this, which is what the trigram index is for.
    const matches = await findPossibleDuplicates(context(), 'Anita Menon');
    expect(matches.map((m) => m.name)).toContain('Anitha Menon');
  });

  it('does not match somebody unrelated', async () => {
    await patient('Anitha Menon');

    const matches = await findPossibleDuplicates(context(), 'Rajesh Kumar');
    expect(matches).toHaveLength(0);
  });

  it('says whether the match is on a ward right now', async () => {
    const id = await patient('Priya Nair', 'UH-4471');
    const admissionId = newId();
    await db.insert(admissions).values({
      id: admissionId,
      ipNo: 'IP-9001',
      patientId: id,
      ward: '2B',
      admittedAt: clock.now(),
      status: 'admitted',
    });

    const [match] = await findPossibleDuplicates(context(), 'Priya Nair');
    // "Already on a ward" is the fact that turns a similar name into the same
    // person, and it is what a doctor is actually looking for.
    expect(match?.openAdmission).toBe('IP-9001');
    expect(match?.uhid).toBe('UH-4471');
  });

  it('leaves out a discharged admission', async () => {
    const id = await patient('Suresh Pillai');
    await db.insert(admissions).values({
      id: newId(),
      ipNo: 'IP-9002',
      patientId: id,
      ward: '2B',
      admittedAt: clock.now(),
      dischargedAt: clock.now(),
      status: 'discharged',
    });

    const [match] = await findPossibleDuplicates(context(), 'Suresh Pillai');
    expect(match?.openAdmission).toBeNull();
  });

  it('asks nothing of the database for a fragment', async () => {
    await patient('Anitha Menon');

    // Two characters match half a ward. The threshold is on the input, not just
    // on the similarity score.
    expect(await findPossibleDuplicates(context(), 'An')).toHaveLength(0);
    expect(await findPossibleDuplicates(context(), '  ')).toHaveLength(0);
  });

  it('returns the closest first, and not too many', async () => {
    await patient('Anitha Menon');
    await patient('Anitha Menon Nair');
    await patient('Anithaa Menon');
    await patient('Anitha Menonn');

    const matches = await findPossibleDuplicates(context(), 'Anitha Menon');
    expect(matches.length).toBeGreaterThan(1);
    expect(matches[0]?.name).toBe('Anitha Menon');
    // A warning listing twenty people is a warning nobody reads.
    expect(matches.length).toBeLessThanOrEqual(5);
  });

  it('discloses nothing beyond what identifies somebody (§2.10)', async () => {
    await client`UPDATE hospital.patients SET diagnosis = 'Should not appear'`;
    await patient('Meera Das');
    await client`UPDATE hospital.patients SET diagnosis = 'Should not appear'`;

    const [match] = await findPossibleDuplicates(context(), 'Meera Das');
    // Enough to recognise a person, and no more: no diagnosis, no history.
    expect(JSON.stringify(match)).not.toContain('Should not appear');
    expect(Object.keys(match ?? {}).sort()).toEqual([
      'bloodGroup',
      'name',
      'openAdmission',
      'patientId',
      'similarity',
      'uhid',
    ]);
  });
});

describe.skipIf(!testUrl)('the compatibility testing sample (§3, §15)', () => {
  const client = postgres(testUrl ?? '', { max: 4, onnotice: () => undefined });
  const db = drizzle(client) as unknown as Database;
  const clock = createFakeClock('2026-09-09T09:00:00.000Z');
  const CENTRE_ID = '01930000-0000-7000-8000-000000000001';

  let doctor: Actor;
  let doctorId: string;
  let submittedId: string;
  let draftId: string;

  const context = (actor: Actor = doctor): UseCaseContext => ({
    db,
    clock,
    ids: idGenerator,
    ports: { hasher: argon2Hasher, tokens: nodeTokens },
    actor,
    correlationId: newId(),
    config: CONFIG_DEFAULTS,
  });

  beforeEach(async () => {
    await client`TRUNCATE hospital.audit_log, hospital.blood_samples, hospital.blood_requests,
                          hospital.admissions, hospital.patients, hospital.users
                 RESTART IDENTITY CASCADE`;
    await client`INSERT INTO hospital.centres (id, name) VALUES (${CENTRE_ID}, 'Test centre')
                 ON CONFLICT (id) DO NOTHING`;

    doctorId = newId();
    doctor = { kind: 'user', userId: doctorId, role: 'doctor', districtScopeId: null };
    await db.insert(users).values({
      id: doctorId,
      email: `doctor-${doctorId}@blood-connect.invalid`,
      fullName: 'Dr Sample',
      role: 'doctor',
      status: 'active',
      passwordHash: 'x'.repeat(20),
    });

    const patientId = newId();
    await db.insert(patients).values({
      id: patientId,
      name: 'Sample Patient',
      age: 50,
      ageUnit: 'years',
      sex: 'male',
      bloodGroup: 'A+',
      previousTransfusion: 'unknown',
    });

    const admissionId = newId();
    await db.insert(admissions).values({
      id: admissionId,
      ipNo: `IP-${admissionId.slice(0, 8)}`,
      patientId,
      ward: '1A',
      admittedAt: clock.now(),
      status: 'admitted',
    });

    submittedId = newId();
    await db.insert(bloodRequests).values({
      id: submittedId,
      requestId: '090926-00900',
      centreId: CENTRE_ID,
      admissionId,
      doctorId,
      status: 'submitted',
      // Required of every non-draft request since ADR 0010.
      urgency: 'routine',
      indication: 'Surgery',
      dateRequired: clock.today(),
      bloodGroup: 'A+',
      product: 'prbc',
      units: 2,
      submittedAt: clock.now(),
      patientSnapshot: { name: 'Sample Patient' },
      doctorSnapshot: { id: doctorId },
    });

    draftId = newId();
    await db.insert(bloodRequests).values({
      id: draftId,
      centreId: CENTRE_ID,
      admissionId,
      doctorId,
      status: 'draft',
    });
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  it('records a sample against a submitted request', async () => {
    const result = await recordSample(context(), submittedId, {
      sampleIdentifier: 'CM-00042',
      collectedAt: clock.now(),
      note: null,
    });

    expect(result.ok).toBe(true);

    const [row] = await listSamples(context(), submittedId);
    expect(row?.sampleIdentifier).toBe('CM-00042');
    // Who drew the tube comes from the session, never the form (§2.5). It is
    // part of the chain of custody.
    expect(row?.collectedBy).toBe('Dr Sample');
  });

  it('refuses an identifier already used anywhere in the hospital (§15)', async () => {
    await recordSample(context(), submittedId, {
      sampleIdentifier: 'CM-00042',
      collectedAt: clock.now(),
      note: null,
    });

    // A second request, a different patient, the same label. Two tubes carrying
    // one identifier is exactly the mix-up the compatibility test exists to
    // prevent, so the uniqueness is global, not per request.
    const otherId = newId();
    await db.insert(bloodRequests).values({
      id: otherId,
      requestId: '090926-00901',
      urgency: 'routine',
      centreId: CENTRE_ID,
      admissionId: (await db.select().from(admissions))[0]?.id ?? '',
      doctorId,
      status: 'submitted',
      indication: 'Surgery',
      dateRequired: clock.today(),
      bloodGroup: 'A+',
      product: 'prbc',
      units: 1,
      submittedAt: clock.now(),
      patientSnapshot: { name: 'Other Patient' },
      doctorSnapshot: { id: doctorId },
    });

    const clash = await recordSample(context(), otherId, {
      sampleIdentifier: 'CM-00042',
      collectedAt: clock.now(),
      note: null,
    });

    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.error.message).toContain('already recorded');
    expect(await listSamples(context(), otherId)).toHaveLength(0);
  });

  it('takes more than one sample for the same request', async () => {
    await recordSample(context(), submittedId, {
      sampleIdentifier: 'CM-1',
      collectedAt: clock.now(),
      note: 'First draw',
    });
    await recordSample(context(), submittedId, {
      sampleIdentifier: 'CM-2',
      collectedAt: clock.now(),
      note: 'Repeat, first tube haemolysed',
    });

    // §3 says "one or more". A repeat draw is ordinary, and hiding the first
    // one would lose the reason there was a second.
    expect(await listSamples(context(), submittedId)).toHaveLength(2);
  });

  it('refuses a sample against a draft', async () => {
    // The tube would reach the laboratory ahead of the request it is for.
    const result = await recordSample(context(), draftId, {
      sampleIdentifier: 'CM-9',
      collectedAt: clock.now(),
      note: null,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses a collection time in the future', async () => {
    const result = await recordSample(context(), submittedId, {
      sampleIdentifier: 'CM-10',
      collectedAt: new Date(clock.now().getTime() + 3_600_000),
      note: null,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses an empty identifier', async () => {
    const result = await recordSample(context(), submittedId, {
      sampleIdentifier: '   ',
      collectedAt: clock.now(),
      note: null,
    });
    expect(result.ok).toBe(false);
  });

  it('does not let another doctor record against this request', async () => {
    const stranger: Actor = {
      kind: 'user',
      userId: newId(),
      role: 'doctor',
      districtScopeId: null,
    };

    const result = await recordSample(context(stranger), submittedId, {
      sampleIdentifier: 'CM-11',
      collectedAt: clock.now(),
      note: null,
    });
    expect(result.ok).toBe(false);
  });

  it('records it in the audit log', async () => {
    await recordSample(context(), submittedId, {
      sampleIdentifier: 'CM-12',
      collectedAt: clock.now(),
      note: null,
    });

    const rows = await client`SELECT action, metadata FROM hospital.audit_log
                               WHERE action = 'sample.recorded'`;
    expect(rows).toHaveLength(1);
  });
});
