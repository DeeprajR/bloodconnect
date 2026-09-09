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
  bloodRequestCounters,
  bloodRequests,
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
import {
  createPatientAndAdmit,
  snapshotOfAdmission,
  type PatientDetails,
  type PatientProblem,
} from '../patient-record.js';

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
  /**
   * Or a patient described inline, which creates the patient and admits them.
   *
   * The same shape the centre uses at the counter — one record, one definition
   * of what it must contain, whoever typed it.
   */
  readonly patient?: PatientDetails | undefined;
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
  | PatientProblem
  | { readonly kind: 'InvalidRequest'; readonly message: string; readonly field: string };

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
      const created = await createPatientAndAdmit(tx, ctx, input.patient, now);
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
