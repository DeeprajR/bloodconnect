'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  createAdmission,
  createPatient,
  dischargeAdmission,
  findPossibleDuplicates,
  raiseRequest,
  recordSample,
  type PossibleDuplicate,
} from '@blood-connect/hospital';
import { cancelRequest } from '@blood-connect/centre';

import { actorHas } from '@blood-connect/platform';

import { useCaseContext } from '@/lib/guards';
import { assertSameOrigin, currentActor } from '@/lib/session';

/**
 * Module 1's server actions (§9.1).
 *
 * Each parses with Zod and calls exactly one use case. The doctor is never in
 * the form: it comes from the session inside the use case (§2.5), so no field
 * here can claim to be somebody else.
 */

export type FormState = { readonly error: string | null; readonly done?: boolean };

/**
 * The single centre this deployment serves.
 *
 * Multi-tenant is not a retrofit (§5) — the column is on every request from day
 * one — but there is one hospital, and asking a doctor which one they are in
 * would be a fifth field for no information.
 */
const CENTRE_ID = '01930000-0000-7000-8000-000000000001';

function value(form: FormData, name: string): string {
  const raw = form.get(name);
  return typeof raw === 'string' ? raw.trim() : '';
}

const optional = (form: FormData, name: string): string | null =>
  value(form, name) === '' ? null : value(form, name);

/* -------------------------------------------------------------------------- */
/* Patients                                                                    */
/* -------------------------------------------------------------------------- */

const patientSchema = z.object({
  name: z.string().min(1, 'Enter the patient’s name.').max(200),
  sex: z.enum(['female', 'male', 'other']),
  bloodGroup: z.string().min(2),
  previousTransfusion: z.enum(['yes', 'no', 'unknown']),
});

export async function createPatientAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const parsed = patientSchema.safeParse({
    name: value(formData, 'name'),
    sex: value(formData, 'sex'),
    bloodGroup: value(formData, 'bloodGroup'),
    previousTransfusion: value(formData, 'previousTransfusion') || 'unknown',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const ageRaw = value(formData, 'age');
  const ctx = await useCaseContext(await currentActor());

  const result = await createPatient(ctx, {
    ...parsed.data,
    dob: optional(formData, 'dob'),
    age: ageRaw === '' ? null : Number(ageRaw),
    ageUnit: ageRaw === '' ? null : (value(formData, 'ageUnit') || 'years') as
      | 'days'
      | 'months'
      | 'years',
    uhid: optional(formData, 'uhid'),
    attenderName: optional(formData, 'attenderName'),
    attenderPhone: optional(formData, 'attenderPhone'),
    address: optional(formData, 'address'),
    diagnosis: optional(formData, 'diagnosis'),
    history: optional(formData, 'history'),
    previousReaction: optional(formData, 'previousReaction'),
  });

  if (!result.ok) return { error: result.error.message };

  revalidatePath('/patients');
  redirect(`/admissions/new?patientId=${result.value.patientId}`);
}

/**
 * Patients who look like the one being typed (§3).
 *
 * **A warning, never a block.** Two people genuinely called Anitha Menon do
 * arrive at the same hospital, and refusing the second admission at 3am is a
 * far worse failure than recording a duplicate — so this returns candidates and
 * the form shows them beside the field.
 *
 * It returns name, hospital ID, group and whether they are on a ward, which is
 * what tells a doctor "this is the same person". Deliberately not the diagnosis
 * or the history: enough to recognise somebody, and no more (§2.10).
 */
export async function findDuplicatesAction(name: string): Promise<PossibleDuplicate[]> {
  const ctx = await useCaseContext(await currentActor());
  if (!actorHas(ctx.actor, 'patients:manage')) return [];
  return findPossibleDuplicates(ctx, name);
}

/* -------------------------------------------------------------------------- */
/* Admissions                                                                  */
/* -------------------------------------------------------------------------- */

export async function createAdmissionAction(
  patientId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const admittedRaw = value(formData, 'admittedAt');
  const admittedAt = admittedRaw === '' ? new Date() : new Date(admittedRaw);
  if (Number.isNaN(admittedAt.getTime())) return { error: 'Give a valid admission time.' };

  const ctx = await useCaseContext(await currentActor());
  const result = await createAdmission(ctx, {
    ipNo: value(formData, 'ipNo'),
    patientId,
    ward: value(formData, 'ward'),
    admittedAt,
  });

  if (!result.ok) return { error: result.error.message };

  revalidatePath('/dashboard');
  redirect(`/admissions/${result.value.admissionId}`);
}

export async function dischargeAction(admissionId: string): Promise<void> {
  await assertSameOrigin();

  const ctx = await useCaseContext(await currentActor());
  await dischargeAdmission(ctx, admissionId);

  revalidatePath(`/admissions/${admissionId}`);
}

/* -------------------------------------------------------------------------- */
/* Requests                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * From an admission straight to the request form, with the patient prefilled.
 *
 * The one path that still starts from a patient: a doctor already looking at an
 * admitted patient should not retype them into the collapsed section.
 */
export async function startRequestAction(admissionId: string): Promise<void> {
  await assertSameOrigin();
  redirect(`/requests/new?admission=${encodeURIComponent(admissionId)}`);
}

/* -------------------------------------------------------------------------- */
/* Raising a request — the whole of what a doctor does (ADR 0010)              */
/* -------------------------------------------------------------------------- */

/**
 * The four fields, and everything else optional.
 *
 * Validation is split the same way the form is: the four are required and
 * refused individually, and the collapsed half is only looked at when the
 * doctor opened it. A doctor at a bedside must never be stopped by a field
 * they were never asked to fill.
 */
const raiseSchema = z.object({
  bloodGroup: z.string().min(2, 'Choose a blood group.'),
  product: z.string().min(2, 'Choose a product.'),
  units: z.coerce.number().int().min(1, 'At least one unit.'),
  urgency: z.enum(['emergency', 'very_urgent', 'urgent', 'routine']),
});

export async function raiseRequestAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const parsed = raiseSchema.safeParse({
    bloodGroup: value(formData, 'bloodGroup'),
    product: value(formData, 'product'),
    units: value(formData, 'units'),
    urgency: value(formData, 'urgency'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the four fields.' };
  }

  const ctx = await useCaseContext(await currentActor());

  /**
   * The collapsed half, read only when there is a name in it.
   *
   * An empty patient name means the section was never opened, which is the
   * ordinary case — the centre identifies the patient when the bystander
   * arrives with the ID.
   */
  const patientName = value(formData, 'patientName');
  const patient =
    patientName === ''
      ? undefined
      : {
          name: patientName,
          ipNo: value(formData, 'ipNo'),
          ward: optional(formData, 'ward') ?? undefined,
          dob: optional(formData, 'dob') ?? undefined,
          age: value(formData, 'age') === '' ? undefined : Number(value(formData, 'age')),
          ageUnit: optional(formData, 'ageUnit') ?? undefined,
          sex: optional(formData, 'sex') ?? undefined,
          bloodGroup: value(formData, 'patientBloodGroup'),
          uhid: optional(formData, 'uhid') ?? undefined,
          attenderName: optional(formData, 'attenderName') ?? undefined,
          attenderPhone: optional(formData, 'attenderPhone') ?? undefined,
          address: optional(formData, 'address') ?? undefined,
          diagnosis: optional(formData, 'diagnosis') ?? undefined,
          history: optional(formData, 'history') ?? undefined,
          previousTransfusion: optional(formData, 'previousTransfusion') ?? undefined,
          previousReaction: optional(formData, 'previousReaction') ?? undefined,
        };

  const result = await raiseRequest(ctx, CENTRE_ID, {
    ...parsed.data,
    indication: optional(formData, 'indication') ?? undefined,
    admissionId: optional(formData, 'admissionId') ?? undefined,
    patient,
  });

  if (!result.ok) return { error: result.error.message };

  revalidatePath('/dashboard');
  // Straight to the ID. It is the only thing the doctor came for, and the
  // sooner it is on screen the sooner they can read it out.
  redirect(`/requests/${result.value.requestUuid}?raised=1`);
}


/**
 * The doctor's one post-submit action (§3, §8).
 *
 * It reaches into `@blood-connect/centre` rather than `hospital`, because
 * cancelling releases reserved bags and withdraws an open demand — three
 * modules' tables, one transaction, and only that module may see all of them.
 * The permission it checks is still the doctor's.
 */
export async function cancelRequestAction(
  requestUuid: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const reason = value(formData, 'reason');
  if (reason.length === 0) {
    return { error: 'Say why. The centre is told, and so is any donor who agreed to come.' };
  }

  const ctx = await useCaseContext(await currentActor());
  const result = await cancelRequest(ctx, requestUuid, reason);
  if (!result.ok) return { error: result.error.message };

  revalidatePath('/dashboard');
  revalidatePath(`/requests/${requestUuid}`);
  return { error: null, done: true };
}

/**
 * Associating a compatibility testing sample (§3, §15).
 *
 * The identifier is globally unique across the hospital, and a duplicate is
 * refused rather than accepted: the label travels on a physical tube to the
 * laboratory, and two tubes carrying the same one is the mix-up the
 * compatibility test exists to catch.
 */
export async function recordSampleAction(
  requestUuid: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const collectedRaw = value(formData, 'collectedAt');
  const collectedAt = collectedRaw === '' ? new Date() : new Date(collectedRaw);
  if (Number.isNaN(collectedAt.getTime())) return { error: 'Give a valid collection time.' };

  const ctx = await useCaseContext(await currentActor());
  const result = await recordSample(ctx, requestUuid, {
    sampleIdentifier: value(formData, 'sampleIdentifier'),
    collectedAt,
    note: optional(formData, 'note'),
  });

  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/requests/${requestUuid}`);
  return { error: null, done: true };
}
