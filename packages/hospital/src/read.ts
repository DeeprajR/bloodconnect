/**
 * The narrow read API (§2).
 *
 * §11.2 forbids one module reading another's tables, so anything outside
 * Module 1 that needs its data gets a purpose-built view type through a
 * function — not a table. When the centre is split into its own deployment
 * these become HTTP calls and nothing else changes.
 *
 * The administration application reads through here too. It is a different
 * deployment over the same database, and the same rule applies for the same
 * reason.
 */

import { and, count, desc, eq, isNull, or } from 'drizzle-orm';
import { admissions, bloodRequests, patients } from '@blood-connect/db';
import { actorHas, createAuditWriter, type UseCaseContext } from '@blood-connect/platform';

export type DoctorActivity = {
  readonly admissionsOpen: number;
  readonly requestsLive: number;
  readonly requestsTotal: number;
};

export type PatientRow = {
  readonly patientId: string;
  readonly name: string;
  readonly uhid: string | null;
  readonly bloodGroup: string;
  readonly ipNo: string;
  readonly ward: string;
  readonly admissionStatus: string;
  readonly admittedAt: Date;
  readonly diagnosis: string | null;
  readonly history: string | null;
  readonly requestCount: number;
};

/**
 * Every patient a doctor has requested blood for, live and historical.
 *
 * **This is the disclosure surface recorded in ADR 0003.** It hands a
 * non-clinical account the diagnosis and history of identifiable patients, so
 * three things hold and must keep holding:
 *
 *  1. It requires `patients:read_all`, which only an administrator has.
 *  2. Every call writes an audit row naming the doctor whose patients were
 *     read and how many records that was — the question a later investigation
 *     asks is "who looked", and a page-view metric does not answer it.
 *  3. Its lawful basis is an open question for counsel (§12.2). The code is
 *     ready; the authority to run it in production is not settled.
 */
export async function getPatientsForDoctor(
  ctx: UseCaseContext,
  doctorId: string,
): Promise<PatientRow[] | undefined> {
  if (!actorHas(ctx.actor, 'patients:read_all')) return undefined;

  const rows = await ctx.db
    .select({
      patientId: patients.id,
      name: patients.name,
      uhid: patients.uhid,
      bloodGroup: patients.bloodGroup,
      ipNo: admissions.ipNo,
      ward: admissions.ward,
      admissionStatus: admissions.status,
      admittedAt: admissions.admittedAt,
      diagnosis: patients.diagnosis,
      history: patients.history,
      requestCount: count(bloodRequests.id),
    })
    .from(bloodRequests)
    .innerJoin(admissions, eq(admissions.id, bloodRequests.admissionId))
    .innerJoin(patients, eq(patients.id, admissions.patientId))
    .where(eq(bloodRequests.doctorId, doctorId))
    .groupBy(
      patients.id,
      patients.name,
      patients.uhid,
      patients.bloodGroup,
      admissions.ipNo,
      admissions.ward,
      admissions.status,
      admissions.admittedAt,
      patients.diagnosis,
      patients.history,
    )
    .orderBy(desc(admissions.admittedAt));

  await ctx.db.transaction(async (tx) => {
    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, ctx.clock.now());
    await audit({
      action: 'patients.read_for_doctor',
      subjectType: 'user',
      subjectId: doctorId,
      // The identifiers, not just a count: "which records were exposed" is the
      // question, and it cannot be reconstructed later from a number.
      metadata: {
        recordCount: rows.length,
        patientIds: rows.map((row) => row.patientId),
      },
    });
  });

  return rows;
}

/**
 * Counts only — no patient is identifiable from this.
 *
 * Answers "is this doctor working" without disclosing anyone's record, so it
 * needs no special permission and writes no audit row. Used on the doctor list,
 * where showing a name would mean disclosing one per row just to render a page.
 */
export async function getDoctorActivity(
  ctx: UseCaseContext,
  doctorId: string,
): Promise<DoctorActivity> {
  /**
   * Work in progress, whether or not a patient has been attached yet.
   *
   * A left join: a request raised with four fields has no admission (ADR 0010),
   * and an inner one counted it as no work at all — which is the opposite of
   * true, since nobody has even identified the patient yet.
   */
  const [open] = await ctx.db
    .select({ n: count() })
    .from(bloodRequests)
    .leftJoin(admissions, eq(admissions.id, bloodRequests.admissionId))
    .where(
      and(
        eq(bloodRequests.doctorId, doctorId),
        or(isNull(bloodRequests.admissionId), eq(admissions.status, 'admitted')),
      ),
    );

  const [live] = await ctx.db
    .select({ n: count() })
    .from(bloodRequests)
    .where(and(eq(bloodRequests.doctorId, doctorId), eq(bloodRequests.status, 'submitted')));

  const [total] = await ctx.db
    .select({ n: count() })
    .from(bloodRequests)
    .where(eq(bloodRequests.doctorId, doctorId));

  return {
    admissionsOpen: open?.n ?? 0,
    requestsLive: live?.n ?? 0,
    requestsTotal: total?.n ?? 0,
  };
}
