'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  createAdmission,
  createDraft,
  createPatient,
  dischargeAdmission,
  findPossibleDuplicates,
  recordSample,
  submitRequest,
  updateDraft,
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

export async function startRequestAction(admissionId: string): Promise<void> {
  await assertSameOrigin();

  const ctx = await useCaseContext(await currentActor());
  const result = await createDraft(ctx, admissionId);
  if (!result.ok) return;

  redirect(`/requests/${result.value.requestUuid}`);
}

export async function saveDraftAction(
  requestUuid: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const ctx = await useCaseContext(await currentActor());
  const result = await updateDraft(ctx, requestUuid, {
    indication: value(formData, 'indication'),
    dateRequired: value(formData, 'dateRequired'),
    bloodGroup: value(formData, 'bloodGroup'),
    product: value(formData, 'product'),
    units: Number(value(formData, 'units') || '0'),
  });

  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/requests/${requestUuid}`);
  redirect(`/requests/${requestUuid}/review`);
}

/**
 * The one action §7.1 exists for. Everything it does commits together, so the
 * identifier it returns is always attached to a request that was actually made.
 */
export async function submitRequestAction(
  requestUuid: string,
  _previous: FormState,
  _formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const ctx = await useCaseContext(await currentActor());
  const result = await submitRequest(ctx, requestUuid);
  if (!result.ok) return { error: result.error.message };

  revalidatePath('/dashboard');
  redirect(`/requests/${requestUuid}`);
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
