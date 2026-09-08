/**
 * Patients, admissions and drafts (§8.2).
 *
 * The parts of Module 1 that are ordinary CRUD, kept honest by three rules:
 * the doctor comes from the session and never from input (§2.5), an IP number
 * is immutable once written, and a request stops being editable the moment it
 * leaves `draft`.
 */

import { and, desc, eq } from 'drizzle-orm';
import { err, ok, type Result } from '@blood-connect/result';
import { admissions, bloodRequests, patients } from '@blood-connect/db';
import {
  isBloodGroup,
  isProduct,
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
const CENTRE_ID = '01930000-0000-7000-8000-000000000001';

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
/* Drafts                                                                      */
/* -------------------------------------------------------------------------- */

export async function createDraft(
  ctx: UseCaseContext,
  admissionId: string,
): Promise<Result<{ requestUuid: string }, DraftError>> {
  if (!actorHas(ctx.actor, 'requests:manage')) return err(notAuthorized('requests:manage'));
  if (ctx.actor.kind !== 'user') return err(notAuthorized('requests:manage'));

  const now = ctx.clock.now();
  const requestUuid = ctx.ids.next<'BloodRequestId'>();
  const doctorId = ctx.actor.userId;

  return ctx.db.transaction(async (tx) => {
    const [admission] = await tx
      .select({ id: admissions.id, patientId: admissions.patientId })
      .from(admissions)
      .where(eq(admissions.id, admissionId));
    if (!admission) return err(admissionNotFound());

    // The patient's own group is the prefill, overridable on the form.
    const [patient] = await tx
      .select({ bloodGroup: patients.bloodGroup })
      .from(patients)
      .where(eq(patients.id, admission.patientId));

    await tx.insert(bloodRequests).values({
      id: requestUuid,
      centreId: CENTRE_ID,
      admissionId,
      // From the session, never from the client (§2.5).
      doctorId,
      status: 'draft',
      bloodGroup: patient?.bloodGroup ?? null,
      product: 'whole_blood',
      units: 1,
      dateRequired: ctx.clock.today(),
    });

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'request.draft_created',
      subjectType: 'blood_request',
      subjectId: requestUuid,
      metadata: { admissionId },
    });

    return ok({ requestUuid });
  });
}

export type DraftInput = {
  readonly indication: string;
  readonly dateRequired: string;
  readonly bloodGroup: string;
  readonly product: string;
  readonly units: number;
};

/**
 * Editing a draft.
 *
 * Every draft endpoint refuses anything that has left `draft` (§8.2) — the
 * conditional UPDATE is what makes that true even if two tabs are open, and the
 * status is read first only so the refusal can say what happened.
 */
export async function updateDraft(
  ctx: UseCaseContext,
  requestUuid: string,
  input: DraftInput,
): Promise<Result<Record<string, never>, DraftError | InvalidPatient>> {
  if (!actorHas(ctx.actor, 'requests:manage')) return err(notAuthorized('requests:manage'));

  if (!isBloodGroup(input.bloodGroup)) return err(invalidPatient('Choose a blood group.'));
  if (!isProduct(input.product)) return err(invalidPatient('Choose a product.'));
  if (!Number.isInteger(input.units) || input.units < 1) {
    return err(invalidPatient('Units must be a whole number, at least 1.'));
  }
  const day = parseCalendarDay(input.dateRequired);
  if (!day) return err(invalidPatient('Give the date the blood is required.'));
  if (day < ctx.clock.today()) {
    return err(invalidPatient('The date required cannot be in the past.'));
  }
  if (input.indication.trim().length === 0) {
    return err(invalidPatient('Enter the indication for transfusion.'));
  }

  const now = ctx.clock.now();
  const actorId = ctx.actor.kind === 'user' ? ctx.actor.userId : null;

  return ctx.db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ status: bloodRequests.status, doctorId: bloodRequests.doctorId })
      .from(bloodRequests)
      .where(eq(bloodRequests.id, requestUuid));

    if (!existing) return err(requestNotFound());
    if (actorId !== null && existing.doctorId !== actorId) return err(requestNotFound());
    if (existing.status !== 'draft') return err(requestNotADraft(existing.status));

    await tx
      .update(bloodRequests)
      .set({
        indication: input.indication.trim(),
        dateRequired: day,
        bloodGroup: input.bloodGroup,
        product: input.product,
        units: input.units,
      })
      .where(and(eq(bloodRequests.id, requestUuid), eq(bloodRequests.status, 'draft')));

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'request.draft_updated',
      subjectType: 'blood_request',
      subjectId: requestUuid,
    });

    return ok({});
  });
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export type RequestListRow = {
  readonly id: string;
  readonly requestId: string | null;
  readonly status: string;
  readonly bloodGroup: BloodGroup | null;
  readonly product: Product | null;
  readonly units: number | null;
  readonly dateRequired: string | null;
  readonly patientName: string;
  readonly ipNo: string;
  readonly updatedAt: Date;
};

export async function listRequestsForDoctor(
  ctx: UseCaseContext,
  doctorId: string,
): Promise<RequestListRow[]> {
  const rows = await ctx.db
    .select({
      id: bloodRequests.id,
      requestId: bloodRequests.requestId,
      status: bloodRequests.status,
      bloodGroup: bloodRequests.bloodGroup,
      product: bloodRequests.product,
      units: bloodRequests.units,
      dateRequired: bloodRequests.dateRequired,
      patientName: patients.name,
      ipNo: admissions.ipNo,
      updatedAt: bloodRequests.updatedAt,
    })
    .from(bloodRequests)
    .innerJoin(admissions, eq(admissions.id, bloodRequests.admissionId))
    .innerJoin(patients, eq(patients.id, admissions.patientId))
    .where(eq(bloodRequests.doctorId, doctorId))
    .orderBy(desc(bloodRequests.updatedAt));

  return rows as RequestListRow[];
}

export async function getRequest(ctx: UseCaseContext, requestUuid: string) {
  const [row] = await ctx.db
    .select({
      request: bloodRequests,
      admission: admissions,
      patient: patients,
    })
    .from(bloodRequests)
    .innerJoin(admissions, eq(admissions.id, bloodRequests.admissionId))
    .innerJoin(patients, eq(patients.id, admissions.patientId))
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

/** True when the required day has passed and no decision exists (§3). */
export const isOverdue = (row: {
  status: string;
  dateRequired: string | null;
}, today: string): boolean =>
  row.status === 'submitted' && row.dateRequired !== null && row.dateRequired < today;
