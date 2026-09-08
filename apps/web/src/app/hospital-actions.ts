'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  createAdmission,
  createDraft,
  createPatient,
  dischargeAdmission,
  submitRequest,
  updateDraft,
} from '@blood-connect/hospital';

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
