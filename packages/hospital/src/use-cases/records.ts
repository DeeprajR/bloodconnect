/**
 * Patients, admissions and drafts (§8.2).
 *
 * The parts of Module 1 that are ordinary CRUD, kept honest by three rules:
 * the doctor comes from the session and never from input (§2.5), an IP number
 * is immutable once written, and a request stops being editable the moment it
 * leaves `draft`.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import { err, ok, type Result } from '@blood-connect/result';
import { admissions, bloodRequests, bloodSamples, patients, users } from '@blood-connect/db';
import {
  isBloodGroup,
  parseCalendarDay,
  type BloodGroup,
  type Product,
} from '@blood-connect/domain';
import { actorHas, createAuditWriter, type UseCaseContext } from '@blood-connect/platform';

import {
  admissionNotFound,
  invalidPatient,
  ipNumberTaken,
  notAuthorized,
  requestNotADraft,
  requestNotFound,
  type AdmissionNotFound,
  type DraftError,
  type InvalidPatient,
  type IpNumberTaken,
  type NotAuthorized,
} from '../errors.js';

/** This deployment's centre. Multi-tenant needs more rows, not a migration. */
/* -------------------------------------------------------------------------- */
/* Patients                                                                    */
/* -------------------------------------------------------------------------- */

export type PatientInput = {
  readonly name: string;
  readonly dob: string | null;
  readonly age: number | null;
  readonly ageUnit: 'days' | 'months' | 'years' | null;
  readonly sex: 'female' | 'male' | 'other';
  readonly bloodGroup: string;
  readonly uhid: string | null;
  readonly attenderName: string | null;
  readonly attenderPhone: string | null;
  readonly address: string | null;
  readonly diagnosis: string | null;
  readonly history: string | null;
  readonly previousTransfusion: 'yes' | 'no' | 'unknown';
  readonly previousReaction: string | null;
};

/**
 * A neonate is recorded in days and may have no birth date at all (§3), so the
 * rule is "one of the two", not "date of birth required".
 */
function checkPatient(input: PatientInput): InvalidPatient | undefined {
  if (input.name.trim().length === 0) return invalidPatient('Enter the patient’s name.');
  if (!isBloodGroup(input.bloodGroup)) return invalidPatient('Choose a blood group.');

  const hasDob = input.dob !== null && parseCalendarDay(input.dob) !== undefined;
  const hasAge = input.age !== null && input.ageUnit !== null;
  if (!hasDob && !hasAge) {
    return invalidPatient('Give a date of birth, or an age with its unit.');
  }
  if (input.age !== null && input.age < 0) return invalidPatient('Age cannot be negative.');

  // A reaction without a previous transfusion is a contradiction, and the
  // database refuses it — caught here so it reads as a sentence.
  if (input.previousReaction && input.previousTransfusion !== 'yes') {
    return invalidPatient(
      'A reaction can only be recorded when there was a previous transfusion.',
    );
  }

  return undefined;
}

export async function createPatient(
  ctx: UseCaseContext,
  input: PatientInput,
): Promise<Result<{ patientId: string }, NotAuthorized | InvalidPatient>> {
  if (!actorHas(ctx.actor, 'patients:manage')) return err(notAuthorized('patients:manage'));

  const problem = checkPatient(input);
  if (problem) return err(problem);

  const now = ctx.clock.now();
  const patientId = ctx.ids.next<'PatientId'>();

  return ctx.db.transaction(async (tx) => {
    await tx.insert(patients).values({
      id: patientId,
      name: input.name.trim(),
      dob: input.dob,
      age: input.age,
      ageUnit: input.ageUnit,
      sex: input.sex,
      bloodGroup: input.bloodGroup,
      uhid: input.uhid?.trim() ?? null,
      attenderName: input.attenderName,
      attenderPhone: input.attenderPhone,
      address: input.address,
      diagnosis: input.diagnosis,
      history: input.history,
      previousTransfusion: input.previousTransfusion,
      previousReaction: input.previousTransfusion === 'yes' ? input.previousReaction : null,
      createdBy: ctx.actor.kind === 'user' ? ctx.actor.userId : null,
    });

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({ action: 'patient.created', subjectType: 'patient', subjectId: patientId });

    return ok({ patientId });
  });
}

/* -------------------------------------------------------------------------- */
/* Admissions                                                                  */
/* -------------------------------------------------------------------------- */

export type AdmissionInput = {
  readonly ipNo: string;
  readonly patientId: string;
  readonly ward: string;
  readonly admittedAt: Date;
};

export async function createAdmission(
  ctx: UseCaseContext,
  input: AdmissionInput,
): Promise<Result<{ admissionId: string }, NotAuthorized | IpNumberTaken | InvalidPatient>> {
  if (!actorHas(ctx.actor, 'patients:manage')) return err(notAuthorized('patients:manage'));

  const ipNo = input.ipNo.trim();
  if (ipNo.length === 0) return err(invalidPatient('Enter the IP number.'));
  if (input.ward.trim().length === 0) return err(invalidPatient('Enter the ward number.'));
  if (input.admittedAt.getTime() > ctx.clock.now().getTime()) {
    return err(invalidPatient('The admission time cannot be in the future.'));
  }

  const now = ctx.clock.now();
  const admissionId = ctx.ids.next<'AdmissionId'>();

  return ctx.db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: admissions.id })
      .from(admissions)
      .where(eq(admissions.ipNo, ipNo));
    if (existing.length > 0) return err(ipNumberTaken());

    await tx.insert(admissions).values({
      id: admissionId,
      ipNo,
      patientId: input.patientId,
      ward: input.ward.trim(),
      admittedAt: input.admittedAt,
      status: 'admitted',
      createdBy: ctx.actor.kind === 'user' ? ctx.actor.userId : null,
    });

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'admission.created',
      subjectType: 'admission',
      subjectId: admissionId,
      metadata: { ipNo, patientId: input.patientId },
    });

    return ok({ admissionId });
  });
}

export async function dischargeAdmission(
  ctx: UseCaseContext,
  admissionId: string,
): Promise<Result<Record<string, never>, NotAuthorized | AdmissionNotFound>> {
  if (!actorHas(ctx.actor, 'patients:manage')) return err(notAuthorized('patients:manage'));

  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const rows = await tx
      .update(admissions)
      .set({ status: 'discharged', dischargedAt: now })
      .where(and(eq(admissions.id, admissionId), eq(admissions.status, 'admitted')))
      .returning({ id: admissions.id });

    if (rows.length === 0) return err(admissionNotFound());

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'admission.discharged',
      subjectType: 'admission',
      subjectId: admissionId,
    });

    return ok({});
  });
}

/* -------------------------------------------------------------------------- */
/* Drafts — removed by ADR 0010                                                */
/* -------------------------------------------------------------------------- */

/*
 * `createDraft`, `updateDraft`, `draftAgeDays` and `isStaleDraft` lived here.
 *
 * A request is now four fields on one screen (`raiseRequest`), so there is
 * nothing to save and reopen and nothing to age. The stale-draft surfacing on
 * the doctor's dashboard went with them.
 *
 * Rows with `status = 'draft'` raised before the change are left alone: an old
 * draft may be the only record that something was intended, and deleting one to
 * tidy up a state machine would destroy it.
 */


/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export type RequestListRow = {
  readonly id: string;
  readonly requestId: string | null;
  readonly status: string;
  readonly urgency: string | null;
  readonly bloodGroup: BloodGroup | null;
  readonly product: Product | null;
  readonly units: number | null;
  readonly dateRequired: string | null;
  /** Null until the centre attaches a patient (ADR 0010). */
  readonly patientName: string | null;
  readonly ipNo: string | null;
  readonly submittedAt: Date | null;
  readonly updatedAt: Date;
};

/**
 * A doctor's own requests.
 *
 * **Left joins, not inner ones.** A request is raised with four fields and no
 * patient (ADR 0010), and inner joins here dropped every one of them — the
 * doctor submitted a request, got an ID, and then could not see it on their own
 * dashboard. The most common request in the system was the one it hid.
 */
export async function listRequestsForDoctor(
  ctx: UseCaseContext,
  doctorId: string,
): Promise<RequestListRow[]> {
  const rows = await ctx.db
    .select({
      id: bloodRequests.id,
      requestId: bloodRequests.requestId,
      status: bloodRequests.status,
      urgency: bloodRequests.urgency,
      bloodGroup: bloodRequests.bloodGroup,
      product: bloodRequests.product,
      units: bloodRequests.units,
      dateRequired: bloodRequests.dateRequired,
      patientName: patients.name,
      ipNo: admissions.ipNo,
      submittedAt: bloodRequests.submittedAt,
      updatedAt: bloodRequests.updatedAt,
    })
    .from(bloodRequests)
    .leftJoin(admissions, eq(admissions.id, bloodRequests.admissionId))
    .leftJoin(patients, eq(patients.id, admissions.patientId))
    .where(eq(bloodRequests.doctorId, doctorId))
    .orderBy(desc(bloodRequests.updatedAt));

  return rows as RequestListRow[];
}

/**
 * One request, with its patient **if it has one yet**.
 *
 * Left joins, not inner ones. A request is raised with four fields and no
 * patient (ADR 0010); an inner join here would return nothing for it, and the
 * doctor who just raised it would get a 404 on their own request.
 */
export async function getRequest(ctx: UseCaseContext, requestUuid: string) {
  const [row] = await ctx.db
    .select({
      request: bloodRequests,
      admission: admissions,
      patient: patients,
    })
    .from(bloodRequests)
    .leftJoin(admissions, eq(admissions.id, bloodRequests.admissionId))
    .leftJoin(patients, eq(patients.id, admissions.patientId))
    .where(eq(bloodRequests.id, requestUuid));

  return row;
}

export async function listAdmissions(ctx: UseCaseContext) {
  return ctx.db
    .select({
      id: admissions.id,
      ipNo: admissions.ipNo,
      ward: admissions.ward,
      status: admissions.status,
      admittedAt: admissions.admittedAt,
      patientId: patients.id,
      patientName: patients.name,
      bloodGroup: patients.bloodGroup,
    })
    .from(admissions)
    .innerJoin(patients, eq(patients.id, admissions.patientId))
    .orderBy(desc(admissions.admittedAt))
    .limit(100);
}

/* -------------------------------------------------------------------------- */
/* The compatibility testing sample (§3, §15)                                  */
/* -------------------------------------------------------------------------- */

export type SampleRow = {
  readonly id: string;
  readonly sampleIdentifier: string;
  readonly collectedAt: Date;
  readonly collectedBy: string | null;
  readonly note: string | null;
};

/**
 * Associates a sample with a submitted request (§3).
 *
 * The identifier is globally unique, and the refusal on a duplicate is the
 * point rather than an inconvenience: it travels on a physical tube between the
 * ward and the laboratory, and two tubes with the same label for different
 * patients is exactly the mix-up the compatibility test exists to prevent.
 *
 * **Only on a request that has been submitted.** A sample drawn against a draft
 * belongs to nothing the centre can see, and the tube would arrive at the
 * laboratory ahead of the request it is for.
 */
export async function recordSample(
  ctx: UseCaseContext,
  requestUuid: string,
  input: { sampleIdentifier: string; collectedAt: Date; note: string | null },
): Promise<Result<{ sampleId: string }, DraftError | InvalidPatient>> {
  if (!actorHas(ctx.actor, 'requests:manage')) return err(notAuthorized('requests:manage'));

  const identifier = input.sampleIdentifier.trim();
  if (identifier.length === 0) {
    return err(invalidPatient('Enter the identifier printed on the tube.'));
  }
  if (input.collectedAt.getTime() > ctx.clock.now().getTime()) {
    return err(invalidPatient('The collection time cannot be in the future.'));
  }

  const now = ctx.clock.now();
  const sampleId = ctx.ids.next<'SampleId'>();
  const actorId = ctx.actor.kind === 'user' ? ctx.actor.userId : null;

  return ctx.db.transaction(async (tx) => {
    const [request] = await tx
      .select({ status: bloodRequests.status, doctorId: bloodRequests.doctorId })
      .from(bloodRequests)
      .where(eq(bloodRequests.id, requestUuid));

    if (!request) return err(requestNotFound());
    if (actorId !== null && request.doctorId !== actorId) return err(requestNotFound());
    if (request.status === 'draft') return err(requestNotADraft('draft'));

    const inserted = await tx
      .insert(bloodSamples)
      .values({
        id: sampleId,
        requestId: requestUuid,
        sampleIdentifier: identifier,
        collectedAt: input.collectedAt,
        // From the session, never the form (§2.5) — who drew the tube is part
        // of the chain of custody.
        collectedByDoctorId: actorId,
        note: input.note,
      })
      .onConflictDoNothing()
      .returning({ id: bloodSamples.id });

    if (inserted.length === 0) {
      return err(
        invalidPatient(
          `Sample ${identifier} is already recorded. Identifiers are unique across the ` +
            'hospital, so check the tube in your hand against the label.',
        ),
      );
    }

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'sample.recorded',
      subjectType: 'blood_request',
      subjectId: requestUuid,
      metadata: { sampleId, sampleIdentifier: identifier },
    });

    return ok({ sampleId });
  });
}

/** Every sample drawn for a request, newest first. Shown on its view (§3). */
export async function listSamples(
  ctx: UseCaseContext,
  requestUuid: string,
): Promise<SampleRow[]> {
  return ctx.db
    .select({
      id: bloodSamples.id,
      sampleIdentifier: bloodSamples.sampleIdentifier,
      collectedAt: bloodSamples.collectedAt,
      collectedBy: users.fullName,
      note: bloodSamples.note,
    })
    .from(bloodSamples)
    .leftJoin(users, eq(users.id, bloodSamples.collectedByDoctorId))
    .where(eq(bloodSamples.requestId, requestUuid))
    .orderBy(desc(bloodSamples.collectedAt));
}

/* -------------------------------------------------------------------------- */
/* The duplicate-patient warning (§3)                                          */
/* -------------------------------------------------------------------------- */

export type PossibleDuplicate = {
  readonly patientId: string;
  readonly name: string;
  readonly uhid: string | null;
  readonly bloodGroup: string;
  readonly similarity: number;
  readonly openAdmission: string | null;
};

/**
 * Patients who look like the one being recorded (§3).
 *
 * **A warning, never a block.** Two people genuinely called Anitha Menon arrive
 * at the same hospital, and refusing the second admission at 3am is a far worse
 * failure than recording a duplicate. So this returns candidates and the screen
 * shows them; the doctor decides.
 *
 * Trigram similarity rather than an exact match, because human-entered names
 * are misspelled, transliterated and abbreviated — `patients_name_trgm_idx`
 * exists for exactly this query, and an exact index would find none of it.
 */
export async function findPossibleDuplicates(
  ctx: UseCaseContext,
  name: string,
  limit = 5,
): Promise<PossibleDuplicate[]> {
  const trimmed = name.trim();
  if (trimmed.length < 3) return [];

  const rows = await ctx.db
    .select({
      patientId: patients.id,
      name: patients.name,
      uhid: patients.uhid,
      bloodGroup: patients.bloodGroup,
      similarity: sql<number>`similarity(${patients.name}, ${trimmed})`,
      /**
       * The column is named **fully**, not interpolated.
       *
       * Drizzle renders `${patients.id}` inside a select-list `sql` as a bare
       * `"id"`, which inside this subquery resolves to `a.id` — the admission's
       * own id. `a.patient_id = a.id` is never true, so every patient came back
       * with no open admission and nothing errored. A silent null, found by a
       * test that expected an IP number.
       *
       * In a `where` clause Drizzle qualifies the same expression properly; it
       * is the select list that does not. Writing the name out is the reliable
       * form.
       */
      openAdmission: sql<string | null>`(
        SELECT a.ip_no FROM hospital.admissions a
         WHERE a.patient_id = hospital.patients.id AND a.status = 'admitted'
         ORDER BY a.admitted_at DESC LIMIT 1
      )`,
    })
    .from(patients)
    // 0.3 is Postgres' own default threshold for `%`. Lower finds noise; higher
    // misses the transliteration differences this is here to catch.
    .where(sql`similarity(${patients.name}, ${trimmed}) > 0.3`)
    .orderBy(sql`similarity(${patients.name}, ${trimmed}) DESC`)
    .limit(limit);

  return rows;
}

/** True when the required day has passed and no decision exists (§3). */
export const isOverdue = (row: {
  status: string;
  dateRequired: string | null;
}, today: string): boolean =>
  row.status === 'submitted' && row.dateRequired !== null && row.dateRequired < today;
