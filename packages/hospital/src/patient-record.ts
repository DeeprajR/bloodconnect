/**
 * Creating a patient and admitting them (§3, ADR 0010).
 *
 * **One implementation, two callers.** The doctor may fill this in from the
 * collapsed half of the request form if they happen to have it; the centre fills
 * it in at the counter, which is the ordinary path. Two copies would drift, and
 * the thing they would drift about is what a patient record must contain, which
 * is exactly the thing that must not vary by who typed it.
 *
 * The `ip_no` is the admission's identity, so an existing one is reused rather
 * than rejected: a second request for the same admitted patient is the ordinary
 * case, not an error.
 */

import { eq } from 'drizzle-orm';
import { admissions, patients } from '@blood-connect/db';
import { isBloodGroup } from '@blood-connect/domain';
import { err, ok, type Result } from '@blood-connect/result';
import type { Transaction, UseCaseContext } from '@blood-connect/platform';

/** Everything a patient record can carry. Only four of them are required. */
export type PatientDetails = {
  readonly name: string;
  readonly ipNo: string;
  /** The patient's own group: **not** the group being requested. */
  readonly bloodGroup: string;
  readonly ward?: string | undefined;
  readonly dob?: string | undefined;
  readonly age?: number | undefined;
  readonly ageUnit?: string | undefined;
  readonly sex?: string | undefined;
  readonly uhid?: string | undefined;
  readonly attenderName?: string | undefined;
  readonly attenderPhone?: string | undefined;
  readonly address?: string | undefined;
  readonly diagnosis?: string | undefined;
  readonly history?: string | undefined;
  readonly previousTransfusion?: string | undefined;
  readonly previousReaction?: string | undefined;
};

export type PatientProblem = {
  readonly kind: 'InvalidPatientDetails';
  readonly message: string;
  readonly field: string;
};

const problem = (field: string, message: string): PatientProblem => ({
  kind: 'InvalidPatientDetails',
  message,
  field,
});

/**
 * Empty is absent.
 *
 * A form posts `''` for a field nobody filled, and `''` is not what belongs in a
 * nullable clinical column. `??` would keep it.
 */
export const blank = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

/**
 * What the record requires before it can exist, checked here so a form gets a
 * sentence rather than a constraint violation.
 */
export function validatePatient(input: PatientDetails): PatientProblem | undefined {
  if (input.name.trim().length === 0) {
    return problem('name', 'The patient needs a name.');
  }
  if (input.ipNo.trim().length === 0) {
    return problem('ipNo', 'The admission needs an IP number.');
  }
  /**
   * The patient's **own** group. Not the same claim as the group being
   * requested, an emergency is often answered with O− whatever the patient
   * turns out to be, so it is asked for rather than assumed.
   */
  if (!isBloodGroup(input.bloodGroup)) {
    return problem('bloodGroup', 'Give the patient’s own blood group.');
  }
  /**
   * A date of birth **or** an age with its unit (`patients_age_check`).
   *
   * Neonates are why the unit exists at all (§3): a DOB is often unknown on
   * admission and "four days" is the only age anybody can state.
   */
  const hasDob = blank(input.dob) !== null;
  const hasAge = typeof input.age === 'number' && blank(input.ageUnit) !== null;
  if (!hasDob && !hasAge) {
    return problem('age', 'Give the date of birth, or an age and its unit.');
  }

  return undefined;
}

export type PatientRecord = {
  readonly admissionId: string;
  readonly snapshot: Record<string, unknown>;
};

/** The frozen copy that travels with a request (§2.6). */
export const snapshotFrom = (
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

export async function snapshotOfAdmission(
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

/**
 * Creates the patient and admits them, inside the caller's transaction.
 *
 * Takes a `Transaction` rather than a context on purpose: the patient, the
 * admission and whatever the caller is attaching them to have to commit
 * together, or a crash leaves a request pointing at half a patient.
 */
export async function createPatientAndAdmit(
  tx: Transaction,
  ctx: UseCaseContext,
  input: PatientDetails,
  now: Date,
): Promise<Result<PatientRecord, PatientProblem>> {
  const invalid = validatePatient(input);
  if (invalid) return err(invalid);

  const name = input.name.trim();
  const ipNo = input.ipNo.trim();

  // Already admitted under this number: reuse it. Two requests for one
  // admission is the ordinary case, not an error.
  const [existing] = await tx
    .select({ id: admissions.id })
    .from(admissions)
    .where(eq(admissions.ipNo, ipNo));

  if (existing) {
    const snapshot = await snapshotOfAdmission(tx, existing.id);
    if (!snapshot) return err(problem('ipNo', 'That admission is unreadable.'));
    return ok({ admissionId: existing.id, snapshot });
  }

  const patientId = ctx.ids.next<'PatientId'>();
  const admissionId = ctx.ids.next<'AdmissionId'>();
  /**
   * NOT NULL on the admission, and the counter may not have been told.
   *
   * Recorded as unstated rather than invented. A made-up ward is worse than an
   * absent one, because somebody will go looking for the patient there.
   */
  const ward = blank(input.ward) ?? 'not stated';

  const [patient] = await tx
    .insert(patients)
    .values({
      id: patientId,
      name,
      dob: blank(input.dob),
      age: input.age ?? null,
      ageUnit: blank(input.ageUnit),
      sex: blank(input.sex) ?? 'other',
      bloodGroup: input.bloodGroup,
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

  if (!patient) return err(problem('name', 'The patient could not be saved.'));

  await tx.insert(admissions).values({
    id: admissionId,
    ipNo,
    patientId,
    ward,
    admittedAt: now,
    status: 'admitted',
  });

  return ok({ admissionId, snapshot: snapshotFrom(patient, ipNo, ward) });
}
