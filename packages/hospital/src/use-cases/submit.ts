/**
 * Submitting a blood request (§7.1, §2.6, §8.2).
 *
 * One transaction does four things, and they must be the same four or none:
 *
 *   1. Allocate the next identifier for the year, in a single statement.
 *   2. Freeze the patient and doctor snapshots.
 *   3. Flip the status to `submitted`.
 *   4. Write the audit row.
 *
 * The reason this is one transaction rather than a tidy sequence is the
 * counter. If allocation committed separately, a submit that then failed would
 * burn `BR-2026-000143` — and a clinical record series with a hole in it is one
 * that somebody will later spend an afternoon reconciling, because a missing
 * number looks exactly like a deleted request.
 */

import { and, eq, sql } from 'drizzle-orm';
import { err, ok, type Result } from '@blood-connect/result';
import {
  admissions,
  bloodRequestCounters,
  bloodRequests,
  patients,
  users,
} from '@blood-connect/db';
import { formatRequestNumber, isBloodGroup, isProduct } from '@blood-connect/domain';
import {
  actorHas,
  createAuditWriter,
  type Transaction,
  type UseCaseContext,
} from '@blood-connect/platform';

import {
  incompleteDraft,
  notAuthorized,
  requestNotFound,
  requestNotADraft,
  type SubmitError,
} from '../errors.js';

export type SubmitResult = {
  readonly requestId: string;
  readonly year: number;
  readonly sequence: number;
};

/**
 * Allocates the next number for the year, in one statement (§7.1).
 *
 * `ON CONFLICT DO UPDATE ... RETURNING next_value - 1` is an upsert-and-read in
 * a single round trip, so two doctors submitting in the same millisecond
 * serialise on the counter row and get consecutive numbers. A read followed by
 * a write would let both read 142 and both write 143.
 */
async function allocateNumber(tx: Transaction, year: number): Promise<number> {
  const rows = await tx
    .insert(bloodRequestCounters)
    .values({ year, nextValue: 2 })
    .onConflictDoUpdate({
      target: bloodRequestCounters.year,
      set: { nextValue: sql`${bloodRequestCounters.nextValue} + 1` },
    })
    .returning({ allocated: sql<number>`${bloodRequestCounters.nextValue} - 1` });

  const allocated = rows[0]?.allocated;
  if (allocated === undefined) throw new Error('the request counter returned no row');
  return allocated;
}

export async function submitRequest(
  ctx: UseCaseContext,
  requestUuid: string,
): Promise<Result<SubmitResult, SubmitError>> {
  if (!actorHas(ctx.actor, 'requests:manage')) return err(notAuthorized('requests:manage'));

  const now = ctx.clock.now();
  const actorId = ctx.actor.kind === 'user' ? ctx.actor.userId : null;

  return ctx.db.transaction(async (tx) => {
    const [draft] = await tx
      .select()
      .from(bloodRequests)
      .where(eq(bloodRequests.id, requestUuid))
      .for('update');

    if (!draft) return err(requestNotFound());
    // A doctor submits their own request. Not a courtesy: the doctor snapshot
    // is taken from the session, so submitting someone else's draft would
    // attribute it to the wrong clinician.
    if (actorId !== null && draft.doctorId !== actorId) return err(requestNotFound());
    if (draft.status !== 'draft') return err(requestNotADraft(draft.status));

    /* --- everything the review screen showed must still be there --------- */
    const missing: string[] = [];
    if (!draft.indication?.trim()) missing.push('indication');
    if (!draft.dateRequired) missing.push('dateRequired');
    if (!draft.bloodGroup || !isBloodGroup(draft.bloodGroup)) missing.push('bloodGroup');
    if (!draft.product || !isProduct(draft.product)) missing.push('product');
    if (draft.units === null || draft.units < 1) missing.push('units');
    if (missing.length > 0) return err(incompleteDraft(missing));

    /* --- the snapshots, frozen here and never recomputed (§2.6) ---------- */
    const [context] = await tx
      .select({
        patient: patients,
        admission: admissions,
        doctor: {
          id: users.id,
          fullName: users.fullName,
          provisionalReg: users.provisionalReg,
          email: users.email,
        },
      })
      .from(bloodRequests)
      .innerJoin(admissions, eq(admissions.id, bloodRequests.admissionId))
      .innerJoin(patients, eq(patients.id, admissions.patientId))
      .innerJoin(users, eq(users.id, bloodRequests.doctorId))
      .where(eq(bloodRequests.id, requestUuid));

    if (!context) return err(requestNotFound());

    const patientSnapshot = {
      name: context.patient.name,
      dob: context.patient.dob,
      age: context.patient.age,
      ageUnit: context.patient.ageUnit,
      sex: context.patient.sex,
      bloodGroup: context.patient.bloodGroup,
      uhid: context.patient.uhid,
      diagnosis: context.patient.diagnosis,
      history: context.patient.history,
      previousTransfusion: context.patient.previousTransfusion,
      previousReaction: context.patient.previousReaction,
      ipNo: context.admission.ipNo,
      ward: context.admission.ward,
    };

    const doctorSnapshot = {
      id: context.doctor.id,
      fullName: context.doctor.fullName,
      provisionalReg: context.doctor.provisionalReg,
      email: context.doctor.email,
    };

    /* --- allocate and commit together ------------------------------------ */
    const year = Number(ctx.clock.today().slice(0, 4));
    const sequence = await allocateNumber(tx, year);
    const requestId = formatRequestNumber(year, sequence);

    await tx
      .update(bloodRequests)
      .set({
        requestId,
        status: 'submitted',
        submittedAt: now,
        patientSnapshot,
        doctorSnapshot,
      })
      // Guarded on the status it expects, so a second submit of the same draft
      // moves nothing (§7.4).
      .where(and(eq(bloodRequests.id, requestUuid), eq(bloodRequests.status, 'draft')));

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'request.submitted',
      subjectType: 'blood_request',
      subjectId: requestUuid,
      metadata: {
        requestId,
        bloodGroup: draft.bloodGroup,
        product: draft.product,
        units: draft.units,
      },
    });

    return ok({ requestId, year, sequence });
  });
}
