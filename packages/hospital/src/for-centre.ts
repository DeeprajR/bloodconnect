/**
 * What Module 2 may see and do to a blood request (§11.2).
 *
 * §11.2 forbids one module reading another's tables, so the centre never names
 * `blood_requests`, `admissions` or `patients`. It calls these functions, gets a
 * purpose-built view type back, and that is the whole of its access. A test in
 * `packages/centre` greps its own source for Module 1's table names and fails
 * the build if one appears, because a boundary nobody checks is a boundary that
 * has already been crossed somewhere.
 *
 * **The centre reads the snapshot, never the patient.** A request carries the
 * patient's details frozen at submit (§2.6), and that is what the centre was
 * told — so it is what the centre is shown. This is not an approximation of the
 * live record; it is the more correct answer, and it happens to keep the module
 * boundary clean as well.
 *
 * When the centre becomes its own deployment (§1) these become HTTP calls and
 * `markRequestDecided` becomes a saga. Today they are function calls sharing a
 * transaction, which is strictly better while one process owns both.
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { admissions, bloodRequests } from '@blood-connect/db';
import { actorHas, createAuditWriter } from '@blood-connect/platform';
import type { Transaction, UseCaseContext } from '@blood-connect/platform';
import { err, ok, type Result } from '@blood-connect/result';
import type { BloodGroup, Product } from '@blood-connect/domain';

import { notAuthorized, type NotAuthorized } from './errors.js';
import {
  createPatientAndAdmit,
  validatePatient,
  type PatientDetails,
  type PatientProblem,
} from './patient-record.js';

/** The patient details frozen onto the request at submit (§2.6). */
export type PatientSnapshot = {
  readonly name?: string;
  readonly dob?: string | null;
  readonly age?: number | null;
  readonly ageUnit?: string | null;
  readonly sex?: string;
  readonly bloodGroup?: string;
  readonly uhid?: string | null;
  readonly diagnosis?: string | null;
  readonly history?: string | null;
  readonly previousTransfusion?: string;
  readonly previousReaction?: string | null;
  readonly ipNo?: string;
  readonly ward?: string;
};

export type DoctorSnapshot = {
  readonly id?: string;
  readonly fullName?: string;
  readonly provisionalReg?: string | null;
  readonly email?: string;
};

export type RequestForDecision = {
  readonly id: string;
  readonly requestId: string;
  readonly status: string;
  /** How fast the doctor said it was needed. Null on requests raised before ADR 0010. */
  readonly urgency: string | null;
  /** True until the bystander brings the ID to the counter. */
  readonly awaitingPatient: boolean;
  readonly bloodGroup: BloodGroup;
  readonly product: Product;
  readonly units: number;
  readonly dateRequired: string;
  readonly indication: string;
  readonly submittedAt: Date;
  readonly patient: PatientSnapshot;
  readonly doctor: DoctorSnapshot;
};

/** Everything past `draft` carries both snapshots — the CHECK in §5.4 says so. */
function toDecisionView(row: {
  id: string;
  requestId: string | null;
  status: string;
  urgency: string | null;
  admissionId: string | null;
  bloodGroup: string | null;
  product: string | null;
  units: number | null;
  dateRequired: string | null;
  indication: string | null;
  submittedAt: Date | null;
  patientSnapshot: unknown;
  doctorSnapshot: unknown;
}): RequestForDecision {
  return {
    id: row.id,
    requestId: row.requestId ?? '',
    status: row.status,
    urgency: row.urgency,
    // Null means the bystander has not been to the counter yet (ADR 0010).
    awaitingPatient: row.admissionId === null,
    bloodGroup: (row.bloodGroup ?? 'O+') as BloodGroup,
    product: (row.product ?? 'whole_blood') as Product,
    units: row.units ?? 0,
    dateRequired: row.dateRequired ?? '',
    indication: row.indication ?? '',
    submittedAt: row.submittedAt ?? new Date(0),
    // Every field on both snapshot types is optional, so an absent snapshot
    // degrades to empty rather than to a crash. A non-draft request always has
    // both — the CHECK in §5.4 says so — and this is the draft case.
    patient: row.patientSnapshot ?? {},
    doctor: row.doctorSnapshot ?? {},
  };
}

const DECISION_COLUMNS = {
  id: bloodRequests.id,
  requestId: bloodRequests.requestId,
  status: bloodRequests.status,
  urgency: bloodRequests.urgency,
  admissionId: bloodRequests.admissionId,
  bloodGroup: bloodRequests.bloodGroup,
  product: bloodRequests.product,
  units: bloodRequests.units,
  dateRequired: bloodRequests.dateRequired,
  indication: bloodRequests.indication,
  submittedAt: bloodRequests.submittedAt,
  patientSnapshot: bloodRequests.patientSnapshot,
  doctorSnapshot: bloodRequests.doctorSnapshot,
};

/**
 * The centre's queue: everything submitted and not yet decided.
 *
 * **Ordered by urgency, then by how long it has waited** (ADR 0010). Three of
 * the four urgencies mean today, so the date cannot separate them — a routine
 * request raised on Monday would otherwise sit above an emergency raised this
 * morning. Within a level, oldest first, so nothing is buried under newer work.
 *
 * The `CASE` spells the order out rather than relying on the alphabet, which
 * would put `emergency` after `very_urgent` and be wrong in the one direction
 * that matters. `blood_requests_queue_urgency_idx` is the index this runs on.
 */
export async function listRequestsAwaitingDecision(
  ctx: UseCaseContext,
): Promise<RequestForDecision[]> {
  const rows = await ctx.db
    .select(DECISION_COLUMNS)
    .from(bloodRequests)
    .where(eq(bloodRequests.status, 'submitted'))
    .orderBy(
      sql`CASE ${bloodRequests.urgency}
            WHEN 'emergency'   THEN 0
            WHEN 'very_urgent' THEN 1
            WHEN 'urgent'      THEN 2
            WHEN 'routine'     THEN 3
            ELSE 4
          END`,
      asc(bloodRequests.submittedAt),
    );

  return rows.map(toDecisionView);
}

/** Requests the centre has already answered, newest first. */
export async function listDecidedRequests(
  ctx: UseCaseContext,
  limit = 50,
): Promise<RequestForDecision[]> {
  const rows = await ctx.db
    .select(DECISION_COLUMNS)
    .from(bloodRequests)
    .where(inArray(bloodRequests.status, ['approved', 'partially_approved', 'declined']))
    .orderBy(asc(bloodRequests.dateRequired))
    .limit(limit);

  return rows.map(toDecisionView);
}

export async function getRequestForDecision(
  ctx: UseCaseContext,
  requestUuid: string,
): Promise<RequestForDecision | undefined> {
  const [row] = await ctx.db
    .select(DECISION_COLUMNS)
    .from(bloodRequests)
    .where(eq(bloodRequests.id, requestUuid));

  return row ? toDecisionView(row) : undefined;
}

/**
 * Where the patient stands, in three states rather than two.
 *
 * This was a boolean — "is the admission open?" — and an inner join made a
 * request with no patient at all indistinguishable from a discharged one. The
 * centre screen then told the counter *"the patient has been discharged"* about
 * a request where nobody had ever identified a patient, which is not a smaller
 * version of the truth but a different fact entirely.
 *
 * Since ADR 0010 that is the ordinary case: a request is raised with four
 * fields and the patient arrives later, with the bystander. So `none` is a
 * state the screen has to be able to say out loud.
 *
 * Shown, never enforced — a discharged patient can still need blood that was
 * requested while they were on the ward.
 */
export type AdmissionState = 'admitted' | 'discharged' | 'none';

export async function admissionStateFor(
  ctx: UseCaseContext,
  requestUuid: string,
): Promise<AdmissionState> {
  const [row] = await ctx.db
    .select({ admissionId: bloodRequests.admissionId, status: admissions.status })
    .from(bloodRequests)
    // Left, so a request with no patient still returns its row.
    .leftJoin(admissions, eq(admissions.id, bloodRequests.admissionId))
    .where(eq(bloodRequests.id, requestUuid));

  if (row?.admissionId == null) return 'none';
  return row.status === 'admitted' ? 'admitted' : 'discharged';
}

/* -------------------------------------------------------------------------- */
/* Completing a request at the counter (ADR 0010)                              */
/* -------------------------------------------------------------------------- */

export type AttachError =
  | NotAuthorized
  | PatientProblem
  | { readonly kind: 'RequestNotFound'; readonly message: string }
  | { readonly kind: 'AlreadyAttached'; readonly message: string };

/**
 * The other half of the request slip.
 *
 * A doctor raises four fields and reads an ID to the patient's bystander; the
 * bystander brings it here, and this is where the patient finally gets a name.
 * Until it runs, the request cannot be reserved against or issued — except for
 * an emergency, which may be answered first and completed after (ADR 0010).
 *
 * One transaction: the patient, the admission, the link and the snapshot commit
 * together, because a request pointing at half a patient is worse than one
 * pointing at none.
 *
 * **Attached once.** A second attempt is refused rather than allowed to
 * overwrite: the snapshot is what the centre answered against (§2.6), and
 * silently repointing a request at a different patient is the way a unit ends up
 * recorded against the wrong person. Correcting a mistake is an edit to the
 * patient record, which is versioned, not a re-attach.
 */
export async function attachPatient(
  ctx: UseCaseContext,
  requestUuid: string,
  input: PatientDetails,
): Promise<Result<{ admissionId: string }, AttachError>> {
  if (!actorHas(ctx.actor, 'centre:operate')) return err(notAuthorized('centre:operate'));

  const invalid = validatePatient(input);
  if (invalid) return err(invalid);

  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const [request] = await tx
      .select({ id: bloodRequests.id, admissionId: bloodRequests.admissionId })
      .from(bloodRequests)
      .where(eq(bloodRequests.id, requestUuid))
      .for('update');

    if (!request) {
      return err({ kind: 'RequestNotFound' as const, message: 'That request does not exist.' });
    }
    if (request.admissionId !== null) {
      return err({
        kind: 'AlreadyAttached' as const,
        message: 'This request already has a patient. Edit the patient record instead.',
      });
    }

    const created = await createPatientAndAdmit(tx, ctx, input, now);
    if (!created.ok) return err(created.error);

    await tx
      .update(bloodRequests)
      .set({
        admissionId: created.value.admissionId,
        // Frozen now rather than at submit, because there was nothing to freeze
        // then. Its purpose — a request keeps what it was answered with — is
        // unchanged (§2.6).
        patientSnapshot: created.value.snapshot,
      })
      .where(eq(bloodRequests.id, requestUuid));

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'request.patient_attached',
      subjectType: 'blood_request',
      subjectId: requestUuid,
      // The link, never the person (§11.9).
      metadata: { admissionId: created.value.admissionId },
    });

    return ok({ admissionId: created.value.admissionId });
  });
}

export type DecidedStatus = 'approved' | 'partially_approved' | 'declined';

/**
 * Moves a request to its decided status, inside the centre's transaction.
 *
 * A conditional UPDATE guarded on `submitted` (§7.4), returning whether it
 * actually moved. It takes a `Transaction` rather than a context on purpose:
 * the status change and the decision row have to commit together, and a
 * function that opened its own transaction could not give that guarantee.
 *
 * Returning `false` rather than throwing lets the caller turn "somebody else
 * got there first" into a `Result`, which is what §11.4 asks for.
 */
export async function markRequestDecided(
  tx: Transaction,
  requestUuid: string,
  status: DecidedStatus,
): Promise<boolean> {
  const rows = await tx
    .update(bloodRequests)
    .set({ status })
    .where(and(eq(bloodRequests.id, requestUuid), eq(bloodRequests.status, 'submitted')))
    .returning({ id: bloodRequests.id });

  return rows.length > 0;
}

export type CancelOutcome =
  | { readonly moved: true; readonly from: string }
  | { readonly moved: false; readonly status: string | undefined };

/**
 * Cancels a submitted or decided request, inside somebody else's transaction.
 *
 * §3 gives the doctor exactly one post-submit action, and it has consequences in
 * two other modules: reserved bags go back on the shelf and an open demand is
 * withdrawn. Those must commit with the cancellation or not at all — a request
 * showing cancelled while units stay held for it is how the centre ends up
 * chasing blood nobody needs.
 *
 * So this takes a `Transaction`, like `markRequestDecided`. It reports the
 * status it moved *from*, because the caller needs to know whether there were
 * bags to release: only a decided request ever reserved any.
 */
export async function markRequestCancelled(
  tx: Transaction,
  requestUuid: string,
  reason: string,
  at: Date,
): Promise<CancelOutcome> {
  const [current] = await tx
    .select({ status: bloodRequests.status })
    .from(bloodRequests)
    .where(eq(bloodRequests.id, requestUuid));

  const rows = await tx
    .update(bloodRequests)
    .set({ status: 'cancelled', cancelledAt: at, cancelReason: reason })
    .where(
      and(
        eq(bloodRequests.id, requestUuid),
        // Guarded on the statuses §3 allows it from (§7.4). A draft is not
        // cancelled — it is left, and ages visibly on the dashboard (§8).
        inArray(bloodRequests.status, ['submitted', 'approved', 'partially_approved']),
      ),
    )
    .returning({ id: bloodRequests.id });

  return rows.length > 0
    ? { moved: true, from: current?.status ?? 'submitted' }
    : { moved: false, status: current?.status };
}

/** Who raised it, so a cancellation can be refused to anybody else. */
export async function doctorOf(
  ctx: UseCaseContext,
  requestUuid: string,
): Promise<string | undefined> {
  const [row] = await ctx.db
    .select({ doctorId: bloodRequests.doctorId })
    .from(bloodRequests)
    .where(eq(bloodRequests.id, requestUuid));

  return row?.doctorId;
}
