import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { CONFIG_DEFAULTS } from '@blood-connect/config';
import { admissions, bloodRequests, patients, users } from '@blood-connect/db';
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

import { raiseRequest, type RaiseInput } from './raise.js';
import { listRequestsForDoctor } from './records.js';
import {
  admissionStateFor,
  attachPatient,
  findRequestByNumber,
  listRequestsAwaitingDecision,
} from '../for-centre.js';

const testUrl = process.env['TEST_DATABASE_URL'];
const CENTRE_ID = '01930000-0000-7000-8000-000000000001';

/**
 * Raising a request — the four fields, and the ID that comes back (§7.1).
 *
 * The doctor's whole job. These assert what a doctor at a bedside experiences:
 * four answers is enough, the ID is sayable, and the optional half never gets in
 * the way of the first four.
 */
describe.skipIf(!testUrl)('raising a blood request (§3, §7.1)', () => {
  const client = postgres(testUrl ?? '', { max: 8, onnotice: () => undefined });
  const db = drizzle(client) as unknown as Database;
  const START = new Date('2026-09-08T09:00:00.000Z');
  const clock = createFakeClock(START);

  let doctorId: string;
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

  /** The four fields, and nothing else. */
  const four: RaiseInput = {
    bloodGroup: 'O+',
    product: 'prbc',
    units: 2,
    urgency: 'urgent',
  };

  const raise = (input: Partial<RaiseInput> = {}) =>
    raiseRequest(context(), CENTRE_ID, { ...four, ...input });

  beforeEach(async () => {
    // The clock is shared and one test moves it a day forward. Without this,
    // whatever runs next starts in the future and its dates are wrong — an
    // order dependency that passes alone and fails in the suite.
    clock.set(START);
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
      status: 'active',
      passwordHash: 'x'.repeat(20),
      provisionalReg: `TCMC-${doctorId.slice(0, 6)}`,
    });
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  /* ==================================================================== */
  /* Four fields is enough                                                 */
  /* ==================================================================== */

  it('raises a request from four answers and nothing else', async () => {
    const result = await raise();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // No patient, and that is the ordinary case now — they are identified at
    // the counter when the bystander arrives (ADR 0010).
    expect(result.value.awaitingPatient).toBe(true);

    const [row] = await db
      .select()
      .from(bloodRequests)
      .where(eq(bloodRequests.id, result.value.requestUuid));

    expect(row?.status).toBe('submitted');
    expect(row?.admissionId).toBeNull();
    expect(row?.patientSnapshot).toBeNull();
    // The doctor is snapshotted at submit, because that half is known (§2.6).
    expect((row?.doctorSnapshot as { fullName: string }).fullName).toBe('Dr Test');
  });

  it('gives back an ID a doctor can read aloud', async () => {
    const result = await raise();
    if (!result.ok) throw new Error('not raised');

    // `DDMMYY-NNNNN`, from the day it was raised (ADR 0010).
    expect(result.value.requestId).toBe('080926-00001');

    const parsed = parseRequestNumber(result.value.requestId);
    expect(parsed?.day).toBe('2026-09-08');
    expect(parsed?.sequence).toBe(1);
  });

  it('numbers requests consecutively within a day', async () => {
    const first = await raise();
    const second = await raise();

    if (!first.ok || !second.ok) throw new Error('not raised');
    expect(first.value.requestId).toBe('080926-00001');
    expect(second.value.requestId).toBe('080926-00002');
  });

  it('restarts the sequence the next day', async () => {
    await raise();
    clock.advanceDays(1);
    const next = await raise();

    if (!next.ok) throw new Error('not raised');
    // A new day, a new counter row, and a sequence that starts again (§7.1).
    expect(next.value.requestId).toBe('090926-00001');
  });

  it('never gives two doctors the same number', async () => {
    // The counter row serialises them; consecutive, never duplicated.
    const results = await Promise.all([raise(), raise(), raise(), raise(), raise()]);
    const ids = results.map((r) => (r.ok ? r.value.requestId : 'failed'));

    expect(new Set(ids).size).toBe(5);
    expect(ids).not.toContain('failed');
  });

  /* ==================================================================== */
  /* Urgency, and the date it derives                                      */
  /* ==================================================================== */

  it('derives the needed-by from the urgency, so nobody types a date', async () => {
    const emergency = await raise({ urgency: 'emergency' });
    const routine = await raise({ urgency: 'routine' });

    if (!emergency.ok || !routine.ok) throw new Error('not raised');
    expect(emergency.value.dateRequired).toBe('2026-09-08');
    // A week out, from the shipped default.
    expect(routine.value.dateRequired).toBe('2026-09-15');
  });

  it('puts three of the four urgencies on the same day, deliberately', async () => {
    const results = await Promise.all([
      raise({ urgency: 'emergency' }),
      raise({ urgency: 'very_urgent' }),
      raise({ urgency: 'urgent' }),
    ]);

    /**
     * The fact the queue is built around: the difference between these three is
     * how fast somebody walks, not what day it is. A date cannot order them,
     * which is why the queue orders by urgency and shows minutes waited.
     */
    const dates = results.map((r) => (r.ok ? r.value.dateRequired : ''));
    expect(new Set(dates).size).toBe(1);
  });

  it('refuses an urgency it does not know', async () => {
    const result = await raise({ urgency: 'whenever' });
    expect(result.ok).toBe(false);
  });

  /* ==================================================================== */
  /* The four, validated                                                   */
  /* ==================================================================== */

  it('refuses a request missing any of the four', async () => {
    expect((await raise({ bloodGroup: 'Z+' })).ok).toBe(false);
    expect((await raise({ product: 'plasma-ish' })).ok).toBe(false);
    expect((await raise({ units: 0 })).ok).toBe(false);
    expect((await raise({ units: 1.5 })).ok).toBe(false);
  });

  it('writes nothing when it refuses', async () => {
    await raise({ units: 0 });
    // The identifier is allocated inside the transaction, so a refused request
    // burns no number and leaves no row.
    expect(await db.select().from(bloodRequests)).toHaveLength(0);
  });

  it('refuses an account that is not a doctor', async () => {
    const centre: Actor = {
      kind: 'user',
      userId: newId(),
      role: 'blood_centre',
      districtScopeId: null,
    };
    const result = await raiseRequest(context({ actor: centre }), CENTRE_ID, four);
    expect(result.ok).toBe(false);
  });

  /* ==================================================================== */
  /* The collapsed half                                                    */
  /* ==================================================================== */

  describe('the optional patient', () => {
    const withPatient = {
      name: 'Test Patient',
      ipNo: 'IP-2026-5501',
      ward: '3B',
      bloodGroup: 'O+',
      sex: 'female',
      age: 34,
      ageUnit: 'years',
    };

    it('creates the patient and admits them when the doctor filled it in', async () => {
      const result = await raise({ patient: withPatient, indication: 'Anaemia' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.awaitingPatient).toBe(false);

      const [row] = await db
        .select()
        .from(bloodRequests)
        .where(eq(bloodRequests.id, result.value.requestUuid));

      expect(row?.admissionId).not.toBeNull();
      // Snapshotted with the request, exactly as before (§2.6).
      expect((row?.patientSnapshot as { name: string }).name).toBe('Test Patient');
      expect((row?.patientSnapshot as { ipNo: string }).ipNo).toBe('IP-2026-5501');
      expect(row?.indication).toBe('Anaemia');

      expect(await db.select().from(patients)).toHaveLength(1);
      expect(await db.select().from(admissions)).toHaveLength(1);
    });

    it('reuses an admission already under that IP number', async () => {
      await raise({ patient: withPatient });
      await raise({ patient: withPatient });

      // A second request for one admitted patient is the ordinary case, not an
      // error — and it must not create a second patient record.
      expect(await db.select().from(admissions)).toHaveLength(1);
      expect(await db.select().from(patients)).toHaveLength(1);
      expect(await db.select().from(bloodRequests)).toHaveLength(2);
    });

    it('asks for a date of birth or an age, as the record requires', async () => {
      // `patients_age_check`: one or the other, and a neonate usually has only
      // the age (§3). Refused with a sentence rather than a database error.
      const result = await raise({
        patient: { name: 'Test Patient', ipNo: 'IP-2026-5505', bloodGroup: 'B+' },
      });
      expect(result.ok).toBe(false);
    });

    it('asks for the patient’s own group rather than assuming the requested one', async () => {
      /**
       * They are different claims. An emergency is often answered with O−
       * whatever the patient turns out to be, so defaulting one from the other
       * would write a clinical fact nobody stated.
       */
      // The type now requires it, so the runtime check is what catches a form
      // that posted an empty select.
      const result = await raise({
        patient: { name: 'Test Patient', ipNo: 'IP-2026-5502', bloodGroup: '' },
      });
      expect(result.ok).toBe(false);
    });

    it('records the ward as unstated rather than inventing one', async () => {
      const result = await raise({
        patient: {
          name: 'Test Patient',
          ipNo: 'IP-2026-5503',
          bloodGroup: 'B+',
          age: 40,
          ageUnit: 'years',
        },
      });

      expect(result.ok).toBe(true);
      const [admission] = await db.select().from(admissions);
      expect(admission?.ward).toBe('not stated');
    });

    it('leaves the request unwritten when the patient half is bad', async () => {
      const result = await raise({
        patient: { name: '', ipNo: 'IP-2026-5504', bloodGroup: 'B+', age: 40, ageUnit: 'years' },
      });

      expect(result.ok).toBe(false);
      // One transaction: a bad patient takes the request down with it rather
      // than leaving a request pointing at half a patient.
      expect(await db.select().from(bloodRequests)).toHaveLength(0);
      expect(await db.select().from(patients)).toHaveLength(0);
    });
  });

  /* ==================================================================== */
  /* The doctor can see what they raised                                   */
  /* ==================================================================== */

  describe('the dashboard', () => {
    /**
     * The bug this describes, found in use.
     *
     * `listRequestsForDoctor` inner-joined the admission and the patient, so a
     * request raised with four fields — which is now the ordinary one — was
     * dropped from the doctor's own dashboard. They submitted, read out an ID,
     * and then could not see the request anywhere.
     */
    it('shows a request that has no patient yet', async () => {
      const raised = await raise();
      if (!raised.ok) throw new Error('not raised');

      const rows = await listRequestsForDoctor(context(), doctorId);

      expect(rows).toHaveLength(1);
      expect(rows[0]?.requestId).toBe(raised.value.requestId);
      // Empty rather than absent: the request is there, the patient is not.
      expect(rows[0]?.patientName).toBeNull();
      expect(rows[0]?.ipNo).toBeNull();
    });

    it('shows one with a patient too, with the name on it', async () => {
      await raise({
        patient: {
          name: 'Test Patient',
          ipNo: 'IP-DASH-1',
          bloodGroup: 'O+',
          age: 30,
          ageUnit: 'years',
        },
      });

      const rows = await listRequestsForDoctor(context(), doctorId);
      expect(rows[0]?.patientName).toBe('Test Patient');
      expect(rows[0]?.ipNo).toBe('IP-DASH-1');
    });

    it('shows both kinds together, and loses neither', async () => {
      await raise();
      await raise({
        patient: {
          name: 'Test Patient',
          ipNo: 'IP-DASH-2',
          bloodGroup: 'O+',
          age: 30,
          ageUnit: 'years',
        },
      });

      const rows = await listRequestsForDoctor(context(), doctorId);
      expect(rows).toHaveLength(2);
      // The urgency is carried, because it is what the doctor chose and the
      // date alone cannot express it.
      expect(rows.every((row) => row.urgency === 'urgent')).toBe(true);
    });

    it('shows another doctor nothing of theirs', async () => {
      await raise();

      const other: Actor = {
        kind: 'user',
        userId: newId(),
        role: 'doctor',
        districtScopeId: null,
      };
      const rows = await listRequestsForDoctor(context({ actor: other }), other.userId);
      expect(rows).toHaveLength(0);
    });
  });

  /* ==================================================================== */
  /* What the centre is told about the patient                             */
  /* ==================================================================== */

  describe('the admission state the centre sees', () => {
    /**
     * This was a boolean, and an inner join made "no patient at all" look
     * exactly like "discharged". The centre screen told a counter *"the patient
     * has been discharged"* about a request where nobody had ever identified a
     * patient — a different fact, and an alarming one to read.
     */
    it('says none when no patient has been attached', async () => {
      const raised = await raise();
      if (!raised.ok) throw new Error('not raised');

      expect(await admissionStateFor(context(), raised.value.requestUuid)).toBe('none');
    });

    it('says admitted once a patient is on it', async () => {
      const raised = await raise({
        patient: {
          name: 'Test Patient',
          ipNo: 'IP-STATE-1',
          bloodGroup: 'O+',
          age: 30,
          ageUnit: 'years',
        },
      });
      if (!raised.ok) throw new Error('not raised');

      expect(await admissionStateFor(context(), raised.value.requestUuid)).toBe('admitted');
    });

    it('says discharged only when there is somebody to discharge', async () => {
      const raised = await raise({
        patient: {
          name: 'Test Patient',
          ipNo: 'IP-STATE-2',
          bloodGroup: 'O+',
          age: 30,
          ageUnit: 'years',
        },
      });
      if (!raised.ok) throw new Error('not raised');

      // Both together: `admissions_status_consistency` refuses a discharge
      // with no time on it, which is the constraint doing its job.
      await client`UPDATE hospital.admissions
                      SET status = 'discharged', discharged_at = now()
                    WHERE ip_no = 'IP-STATE-2'`;

      expect(await admissionStateFor(context(), raised.value.requestUuid)).toBe(
        'discharged',
      );
    });
  });

  /* ==================================================================== */
  /* Completing it at the counter                                          */
  /* ==================================================================== */

  describe('attaching the patient', () => {
    const counter: Actor = {
      kind: 'user',
      userId: '',
      role: 'blood_centre',
      districtScopeId: null,
    };

    const details = {
      name: 'Bystander Named Patient',
      ipNo: 'IP-ATTACH-1',
      bloodGroup: 'A+',
      ward: '4C',
      age: 52,
      ageUnit: 'years',
    };

    const asCounter = async () => {
      const id = newId();
      await db.insert(users).values({
        id,
        email: `counter-${id}@blood-connect.invalid`,
        fullName: 'Counter Staff',
        role: 'blood_centre',
        status: 'active',
        passwordHash: 'x'.repeat(20),
      });
      return context({ actor: { ...counter, userId: id } });
    };

    it('completes a request raised with four fields', async () => {
      const raised = await raise();
      if (!raised.ok) throw new Error('not raised');

      const attached = await attachPatient(await asCounter(), raised.value.requestUuid, details);
      expect(attached.ok).toBe(true);

      const [row] = await db
        .select()
        .from(bloodRequests)
        .where(eq(bloodRequests.id, raised.value.requestUuid));

      expect(row?.admissionId).not.toBeNull();
      // Frozen now rather than at submit, because there was nothing to freeze
      // then (§2.6).
      expect((row?.patientSnapshot as { name: string }).name).toBe(details.name);
      expect(await admissionStateFor(context(), raised.value.requestUuid)).toBe('admitted');
    });

    it('refuses a second patient on the same request', async () => {
      const raised = await raise();
      if (!raised.ok) throw new Error('not raised');

      await attachPatient(await asCounter(), raised.value.requestUuid, details);
      const again = await attachPatient(await asCounter(), raised.value.requestUuid, {
        ...details,
        name: 'Someone Else',
        ipNo: 'IP-ATTACH-2',
      });

      /**
       * Silently repointing a request at a different patient is how a unit ends
       * up recorded against the wrong person. A correction is an edit to the
       * patient record, which is versioned — not a re-attach.
       */
      expect(again.ok).toBe(false);
    });

    it('refuses a doctor at the counter', async () => {
      const raised = await raise();
      if (!raised.ok) throw new Error('not raised');

      // `centre:operate`, which a doctor does not hold (§9).
      const result = await attachPatient(context(), raised.value.requestUuid, details);
      expect(result.ok).toBe(false);
    });

    it('says what is missing rather than failing at the database', async () => {
      const raised = await raise();
      if (!raised.ok) throw new Error('not raised');
      const ctx = await asCounter();

      expect((await attachPatient(ctx, raised.value.requestUuid, { ...details, name: '' })).ok)
        .toBe(false);
      expect((await attachPatient(ctx, raised.value.requestUuid, { ...details, bloodGroup: '' })).ok)
        .toBe(false);
      expect(
        (
          await attachPatient(ctx, raised.value.requestUuid, {
            name: details.name,
            ipNo: details.ipNo,
            bloodGroup: details.bloodGroup,
          })
        ).ok,
      ).toBe(false);
    });
  });

  describe('the queue the counter works from', () => {
    it('puts the most urgent first, whatever order they arrived in', async () => {
      await raise({ urgency: 'routine' });
      await raise({ urgency: 'emergency' });
      await raise({ urgency: 'urgent' });

      const queue = await listRequestsAwaitingDecision(context());

      /**
       * Three of the four urgencies share a date, so ordering by
       * `date_required` would leave the routine request raised first sitting
       * above the emergency raised third.
       */
      expect(queue.map((row) => row.urgency)).toEqual([
        'emergency',
        'urgent',
        'routine',
      ]);
    });

    it('marks the ones still waiting on a bystander', async () => {
      await raise();
      await raise({
        patient: {
          name: 'Test Patient',
          ipNo: 'IP-QUEUE-1',
          bloodGroup: 'O+',
          age: 30,
          ageUnit: 'years',
        },
      });

      const queue = await listRequestsAwaitingDecision(context());
      expect(queue.filter((row) => row.awaitingPatient)).toHaveLength(1);
    });
  });

  /* ==================================================================== */
  /* Finding it at the counter                                             */
  /* ==================================================================== */

  describe('the ID lookup', () => {
    it('finds the request the bystander read out', async () => {
      const raised = await raise();
      if (!raised.ok) throw new Error('not raised');

      const found = await findRequestByNumber(context(), raised.value.requestId);
      expect(found?.id).toBe(raised.value.requestUuid);
    });

    it('accepts it however the counter typed it', async () => {
      const raised = await raise();
      if (!raised.ok) throw new Error('not raised');
      const id = raised.value.requestId;

      // Transcribed by ear, so the separator is whatever they used — or none.
      for (const typed of [id, id.replace('-', ' '), id.replace('-', ''), ` ${id} `]) {
        expect((await findRequestByNumber(context(), typed))?.id).toBe(
          raised.value.requestUuid,
        );
      }
    });

    it('finds nothing rather than guessing at a near miss', async () => {
      await raise();

      /**
       * A wrong digit is a **different request**, not this one. Handing the
       * counter somebody else's record is the failure worth refusing over —
       * there is a person standing there who can read it again.
       */
      // One digit out in the sequence: a different request, and there is not
      // one. The clock is at 2026-09-08, so 00001 *is* the one just raised.
      expect(await findRequestByNumber(context(), '080926-00002')).toBeUndefined();
      // The right sequence on the wrong day.
      expect(await findRequestByNumber(context(), '070926-00001')).toBeUndefined();
      // A four-digit sequence is never padded into a five-digit one.
      expect(await findRequestByNumber(context(), '080926-0001')).toBeUndefined();
      expect(await findRequestByNumber(context(), 'hello')).toBeUndefined();
      expect(await findRequestByNumber(context(), '')).toBeUndefined();
    });

    it('carries whether it still needs a patient', async () => {
      const raised = await raise();
      if (!raised.ok) throw new Error('not raised');

      const found = await findRequestByNumber(context(), raised.value.requestId);
      expect(found?.awaitingPatient).toBe(true);
    });
  });

  /* ==================================================================== */
  /* The record it leaves                                                  */
  /* ==================================================================== */

  it('audits the ask without recording a patient detail', async () => {
    const result = await raise({
      patient: {
        name: 'Test Patient',
        ipNo: 'IP-9',
        bloodGroup: 'O+',
        age: 40,
        ageUnit: 'years',
      },
    });
    if (!result.ok) throw new Error('not raised');

    const rows = await client`SELECT action, metadata FROM hospital.audit_log
                               WHERE subject_id = ${result.value.requestUuid}`;
    const written = JSON.stringify(rows);

    expect(rows.length).toBeGreaterThan(0);
    expect(written).toContain('request.raised');
    // The shape of the ask, never who it was for (§11.9).
    expect(written).not.toContain('Test Patient');
  });
});
