/**
 * Raising a request — four fields and an ID (§3, §7.1, ADR 0010).
 *
 * **The whole of what a doctor does**, and it is one call because it is one
 * screen. There is no draft to save and reopen: a four-field form is submitted
 * or it never existed, and the review step it replaced was four fields shown
 * back to somebody who had just typed them.
 *
 * Everything else about the request — the patient, the admission, the clinical
 * context — is optional here and normally arrives later, at the counter, when
 * the bystander turns up with the ID. A doctor who happens to have it can give
 * it in the same submit, which is what the collapsed section on the form is; a
 * doctor at a bedside with a bleeding patient gives four fields and walks.
 *
 * One transaction, so a request can never exist without its identifier and an
 * identifier can never be burned by a failed submit.
 */

import { eq, sql } from 'drizzle-orm';
import {
  admissions,
  bloodRequestCounters,
  bloodRequests,
  patients,
  users,
} from '@blood-connect/db';
import {
  formatRequestNumber,
  isBloodGroup,
  isProduct,
  isUrgency,
  neededByFor,
  type RequestNumber,
  type Urgency,
} from '@blood-connect/domain';
import { err, ok, type Result } from '@blood-connect/result';
import {
  actorHas,
  createAuditWriter,
  type Transaction,
  type UseCaseContext,
} from '@blood-connect/platform';

import { notAuthorized, type NotAuthorized } from '../errors.js';

/* -------------------------------------------------------------------------- */
/* Input                                                                       */
/* -------------------------------------------------------------------------- */

/** The four. Everything a doctor must give. */
export type RequestEssentials = {
  readonly bloodGroup: string;
  readonly product: string;
  readonly units: number;
  readonly urgency: string;
};

/**
 * The collapsed section (ADR 0010).
 *
 * All optional, all normally filled at the counter. Present here because a
 * doctor who already knows the patient should not have to make the bystander
 * repeat it — but never in the way of the four fields above.
 */
export type RequestExtras = {
  readonly indication?: string | undefined;
  /** An existing admission, if the doctor picked one. */
  readonly admissionId?: string | undefined;
  /** Or a patient described inline, which creates the patient and admits them. */
  readonly patient?:
    | {
        readonly name: string;
        readonly ipNo: string;
        readonly ward?: string | undefined;
        readonly dob?: string | undefined;
        readonly age?: number | undefined;
        readonly ageUnit?: string | undefined;
        readonly sex?: string | undefined;
        readonly bloodGroup?: string | undefined;
        readonly uhid?: string | undefined;
        readonly attenderName?: string | undefined;
        readonly attenderPhone?: string | undefined;
        readonly address?: string | undefined;
        readonly diagnosis?: string | undefined;
        readonly history?: string | undefined;
        readonly previousTransfusion?: string | undefined;
        readonly previousReaction?: string | undefined;
      }
    | undefined;
};

export type RaiseInput = RequestEssentials & RequestExtras;

export type RaiseResult = {
  readonly requestUuid: string;
  /** `DDMMYY-NNNNN` — what the doctor reads aloud to the bystander. */
  readonly requestId: RequestNumber;
  readonly urgency: Urgency;
  readonly dateRequired: string;
  /** True when the patient is still to be identified at the counter. */
  readonly awaitingPatient: boolean;
};

export type RaiseError =
  | NotAuthorized
  | { readonly kind: 'InvalidRequest'; readonly message: string; readonly field: string };

/**
 * Empty is absent.
 *
 * A form posts `''` for a field nobody filled, and `''` is not what belongs in
 * a nullable clinical column. `??` would keep it, so this is a function rather
 * than an operator — and one place to read, rather than fourteen `|| null`s.
 */
const blank = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

const invalid = (field: string, message: string): RaiseError => ({
  kind: 'InvalidRequest',
  message,
  field,
});

/* -------------------------------------------------------------------------- */
/* The allocator (§7.1)                                                        */
/* -------------------------------------------------------------------------- */

/**
 * One statement, inside the caller's transaction.
 *
 * Two doctors submitting in the same millisecond serialise on the counter row
 * and get consecutive numbers, and no number is burned by a failed submit
 * because allocation and insert commit together.
 *
 * Keyed by **day** since ADR 0010: `DDMMYY-NNNNN` restarts its sequence daily.
 */
async function allocateNumber(tx: Transaction, day: string): Promise<number> {
  const rows = await tx
    .insert(bloodRequestCounters)
    .values({ day, nextValue: 2 })
    .onConflictDoUpdate({
      target: bloodRequestCounters.day,
      set: { nextValue: sql`${bloodRequestCounters.nextValue} + 1` },
    })
    .returning({ allocated: sql<number>`${bloodRequestCounters.nextValue} - 1` });

  const allocated = rows[0]?.allocated;
  if (allocated === undefined) throw new Error('the request counter returned no row');
  return allocated;
}

/* -------------------------------------------------------------------------- */
/* Raising                                                                     */
/* -------------------------------------------------------------------------- */

export async function raiseRequest(
  ctx: UseCaseContext,
  centreId: string,
  input: RaiseInput,
): Promise<Result<RaiseResult, RaiseError>> {
  if (!actorHas(ctx.actor, 'requests:manage')) return err(notAuthorized('requests:manage'));
  if (ctx.actor.kind !== 'user') return err(notAuthorized('requests:manage'));

  /* --- the four, validated before anything is written ------------------ */
  if (!isBloodGroup(input.bloodGroup)) return err(invalid('bloodGroup', 'Choose a blood group.'));
  if (!isProduct(input.product)) return err(invalid('product', 'Choose a product.'));
  if (!Number.isInteger(input.units) || input.units < 1) {
    return err(invalid('units', 'How many units? At least one.'));
  }
  if (!isUrgency(input.urgency)) return err(invalid('urgency', 'Choose how urgent this is.'));

  const urgency: Urgency = input.urgency;
  const today = ctx.clock.today();
  const now = ctx.clock.now();
  const doctorId = ctx.actor.userId;

  /**
   * The date, derived rather than typed (ADR 0010).
   *
   * Everything downstream keeps running on `date_required` — the donor demand,
   * the bot's needed-by, the expiry sweep — so it is stored, not recomputed on
   * read. What changed is only who decides it.
   */
  const dateRequired = neededByFor(urgency, today, ctx.config.request.urgencyDays);

  const requestUuid = ctx.ids.next<'RequestId'>();

  return ctx.db.transaction(async (tx) => {
    /* --- the doctor snapshot, frozen here (§2.6) ---------------------- */
    const [doctor] = await tx
      .select({
        id: users.id,
        fullName: users.fullName,
        provisionalReg: users.provisionalReg,
        email: users.email,
      })
      .from(users)
      .where(eq(users.id, doctorId));

    if (!doctor) return err(invalid('doctor', 'That account no longer exists.'));

    /* --- the optional patient, if the doctor had it -------------------- */
    let admissionId = input.admissionId ?? null;
    let patientSnapshot: Record<string, unknown> | null = null;

    if (input.patient) {
      const created = await createPatientAndAdmission(tx, ctx, input.patient, now);
      if (!created.ok) return err(created.error);
      admissionId = created.value.admissionId;
      patientSnapshot = created.value.snapshot;
    } else if (admissionId !== null) {
      const snapshot = await snapshotOfAdmission(tx, admissionId);
      if (!snapshot) return err(invalid('admissionId', 'That admission does not exist.'));
      patientSnapshot = snapshot;
    }

    /* --- allocate and insert together (§7.1) --------------------------- */
    const sequence = await allocateNumber(tx, today);
    const requestId = formatRequestNumber(today, sequence);

    await tx.insert(bloodRequests).values({
      id: requestUuid,
      requestId,
      centreId,
      admissionId,
      doctorId,
      status: 'submitted',
      urgency,
      indication: input.indication?.trim() ?? null,
      dateRequired,
      bloodGroup: input.bloodGroup,
      product: input.product,
      units: input.units,
      submittedAt: now,
      patientSnapshot,
      doctorSnapshot: {
        id: doctor.id,
        fullName: doctor.fullName,
        provisionalReg: doctor.provisionalReg,
        email: doctor.email,
      },
    });

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'request.raised',
      subjectType: 'blood_request',
      subjectId: requestUuid,
      // The clinical shape of the ask, and no patient detail (§11.9).
      metadata: {
        requestId,
        urgency,
        bloodGroup: input.bloodGroup,
        product: input.product,
        units: input.units,
        awaitingPatient: admissionId === null,
      },
    });

    return ok({
      requestUuid,
      requestId,
      urgency,
      dateRequired,
      awaitingPatient: admissionId === null,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* The optional half                                                           */
/* -------------------------------------------------------------------------- */

async function snapshotOfAdmission(
  tx: Transaction,
  admissionId: string,
): Promise<Record<string, unknown> | undefined> {
  const [row] = await tx
    .select({ patient: patients, admission: admissions })
    .from(admissions)
    .innerJoin(patients, eq(patients.id, admissions.patientId))
    .where(eq(admissions.id, admissionId));

  if (!row) return undefined;
  return snapshotFrom(row.patient, row.admission.ipNo, row.admission.ward);
}

const snapshotFrom = (
  patient: typeof patients.$inferSelect,
  ipNo: string,
  ward: string,
): Record<string, unknown> => ({
  name: patient.name,
  dob: patient.dob,
  age: patient.age,
  ageUnit: patient.ageUnit,
  sex: patient.sex,
  bloodGroup: patient.bloodGroup,
  uhid: patient.uhid,
  diagnosis: patient.diagnosis,
  history: patient.history,
  previousTransfusion: patient.previousTransfusion,
  previousReaction: patient.previousReaction,
  ipNo,
  ward,
});

/**
 * Creates the patient and admits them, in the same transaction as the request.
 *
 * Only reached when the doctor opened the collapsed section and filled it. The
 * `ip_no` is the admission's identity, so an existing one is reused rather than
 * rejected — a second request for the same admitted patient is the ordinary
 * case, not an error.
 */
async function createPatientAndAdmission(
  tx: Transaction,
  ctx: UseCaseContext,
  input: NonNullable<RequestExtras['patient']>,
  now: Date,
): Promise<Result<{ admissionId: string; snapshot: Record<string, unknown> }, RaiseError>> {
  const name = input.name.trim();
  const ipNo = input.ipNo.trim();

  if (name.length === 0) return err(invalid('patient.name', 'The patient needs a name.'));
  if (ipNo.length === 0) return err(invalid('patient.ipNo', 'The admission needs an IP number.'));
  /**
   * The patient's own group, required only once the section is opened.
   *
   * `patients.blood_group` is NOT NULL, and it is **not** the same claim as the
   * group being requested — an emergency is often answered with O− regardless
   * of what the patient turns out to be. Defaulting one from the other would
   * write a clinical fact nobody stated, so it is asked for instead.
   */
  if (!isBloodGroup(input.bloodGroup ?? '')) {
    return err(invalid('patient.bloodGroup', 'Give the patient’s own blood group, or leave the patient section closed.'));
  }
  /**
   * A date of birth **or** an age with its unit — `patients_age_check`.
   *
   * Checked here so the form gets a sentence rather than a 500. Neonates are
   * why the unit exists at all (§3): a DOB is often unknown on admission and
   * "four days" is the only age anybody can state.
   */
  const hasDob = (input.dob?.trim() ?? '') !== '';
  const hasAge = typeof input.age === 'number' && (input.ageUnit?.trim() ?? '') !== '';
  if (!hasDob && !hasAge) {
    return err(
      invalid(
        'patient.age',
        'Give the patient’s date of birth, or an age and its unit.',
      ),
    );
  }

  // Already admitted under this number: reuse it. Two requests for one
  // admission is the ordinary case.
  const [existing] = await tx
    .select({ id: admissions.id, patientId: admissions.patientId })
    .from(admissions)
    .where(eq(admissions.ipNo, ipNo));

  if (existing) {
    const snapshot = await snapshotOfAdmission(tx, existing.id);
    if (!snapshot) return err(invalid('patient.ipNo', 'That admission is unreadable.'));
    return ok({ admissionId: existing.id, snapshot });
  }

  const patientId = ctx.ids.next<'PatientId'>();
  const admissionId = ctx.ids.next<'AdmissionId'>();

  const [patient] = await tx
    .insert(patients)
    .values({
      id: patientId,
      name,
      dob: blank(input.dob),
      age: input.age ?? null,
      ageUnit: blank(input.ageUnit),
      sex: blank(input.sex) ?? 'other',
      bloodGroup: input.bloodGroup ?? '',
      uhid: blank(input.uhid),
      attenderName: blank(input.attenderName),
      attenderPhone: blank(input.attenderPhone),
      address: blank(input.address),
      diagnosis: blank(input.diagnosis),
      history: blank(input.history),
      previousTransfusion: blank(input.previousTransfusion) ?? 'unknown',
      previousReaction: blank(input.previousReaction),
    })
    .returning();

  if (!patient) return err(invalid('patient.name', 'The patient could not be saved.'));

  await tx.insert(admissions).values({
    id: admissionId,
    ipNo,
    patientId,
    // NOT NULL on the admission, and the collapsed section may leave it out.
    // Recorded as unstated rather than invented — the centre fills it in when
    // the bystander arrives.
    ward: blank(input.ward) ?? 'not stated',
    admittedAt: now,
    status: 'admitted',
  });

  return ok({
    admissionId,
    snapshot: snapshotFrom(patient, ipNo, blank(input.ward) ?? 'not stated'),
  });
}
