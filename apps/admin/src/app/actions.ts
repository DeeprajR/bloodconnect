'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';

import {
  anonymousActor,
  approveUpdateRequest,
  createDoctor,
  db,
  drainEmailOutbox,
  landingFor,
  nodeTokens,
  rejectUpdateRequest,
  removeSeal,
  resendInvite,
  setAccountStatus,
  setDoctorEmail,
  signIn,
  signOut,
  smtpEmailPort,
  updateDoctor,
  uploadSeal,
  s3Storage,
} from '@blood-connect/platform';

import { useCaseContext } from '@/lib/guards';
import {
  SESSION_COOKIE,
  assertSameOrigin,
  currentActor,
  readSessionToken,
  sessionCookieOptions,
} from '@/lib/session';

/**
 * Server actions for administration (§9.1).
 *
 * Each parses with Zod and calls exactly one use case. No rule lives here.
 *
 * `after()` drains the email outbox once the response is on its way. That is
 * the development stand-in for the worker of §1. The outbox itself is the real
 * mechanism, and moving the drain into a separate process changes nothing about
 * the transactions that write to it.
 */

const drainLater = (): void => {
  after(() => drainEmailOutbox(db, smtpEmailPort, new Date()));
};

/**
 * A form field as a string.
 *
 * `FormData.get` returns `string | File | null`, and a File stringifies to
 * `[object Object]`, which would sail through validation as a perfectly good
 * 15-character password. Anything that is not a string is treated as absent.
 */
function formValue(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

export type FormState = { readonly error: string | null; readonly done?: boolean };

/* -------------------------------------------------------------------------- */
/* Session                                                                     */
/* -------------------------------------------------------------------------- */

const signInSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email address.').max(320),
  password: z.string().min(1, 'Enter your password.').max(1024),
});

export async function signInAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const ctx = await useCaseContext(anonymousActor);
  // Only an administrator signs in here. A doctor's correct password is refused
  // exactly like a wrong one, so this form reveals nothing about the other side.
  const result = await signIn(ctx, { ...parsed.data, audience: 'admin' });
  if (!result.ok) return { error: result.error.message };

  const store = await cookies();
  store.set(SESSION_COOKIE, result.value.token, sessionCookieOptions(result.value.expiresAt));

  redirect(landingFor(result.value.user.role));
}

export async function signOutAction(): Promise<void> {
  await assertSameOrigin();

  const token = await readSessionToken();
  if (token) {
    const ctx = await useCaseContext(await currentActor());
    await signOut(ctx, nodeTokens.fingerprint(token));
  }

  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect('/sign-in');
}

/* -------------------------------------------------------------------------- */
/* Doctors                                                                     */
/* -------------------------------------------------------------------------- */

const doctorSchema = z.object({
  fullName: z.string().trim().min(1, 'Enter the doctor’s name.').max(200),
  email: z.string().trim().min(3, 'Enter an email address.').max(320),
  provisionalReg: z.string().trim().max(64).nullable(),
});

export async function createDoctorAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const parsed = doctorSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    provisionalReg: formValue(formData, 'provisionalReg').trim() || null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const ctx = await useCaseContext(await currentActor());
  const result = await createDoctor(ctx, parsed.data);
  if (!result.ok) return { error: result.error.message };

  drainLater();
  revalidatePath('/doctors');
  redirect(`/doctors/${result.value.userId}`);
}

export async function updateDoctorAction(
  userId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const fullName = formValue(formData, 'fullName').trim();
  const provisionalReg = formValue(formData, 'provisionalReg').trim() || null;
  if (fullName.length === 0) return { error: 'Enter the doctor’s name.' };

  const ctx = await useCaseContext(await currentActor());
  const result = await updateDoctor(ctx, userId, { fullName, provisionalReg });
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/doctors/${userId}`);
  return { error: null, done: true };
}

export async function changeDoctorEmailAction(
  userId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const ctx = await useCaseContext(await currentActor());
  const result = await setDoctorEmail(ctx, userId, formValue(formData, 'email'));
  if (!result.ok) return { error: result.error.message };

  drainLater();
  revalidatePath(`/doctors/${userId}`);
  return { error: null, done: true };
}

export async function resendInviteAction(userId: string): Promise<void> {
  await assertSameOrigin();

  const ctx = await useCaseContext(await currentActor());
  await resendInvite(ctx, userId);

  drainLater();
  revalidatePath(`/doctors/${userId}`);
}

export async function setStatusAction(
  userId: string,
  status: 'active' | 'deactivated',
): Promise<void> {
  await assertSameOrigin();

  const ctx = await useCaseContext(await currentActor());
  await setAccountStatus(ctx, userId, status);

  drainLater();
  revalidatePath(`/doctors/${userId}`);
}

/* -------------------------------------------------------------------------- */
/* Seal                                                                        */
/* -------------------------------------------------------------------------- */

export async function uploadSealAction(
  userId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const file = formData.get('seal');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a PNG file.' };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const ctx = await useCaseContext(await currentActor());
  const result = await uploadSeal(ctx, s3Storage, userId, {
    bytes,
    contentType: file.type,
  });
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/doctors/${userId}`);
  return { error: null, done: true };
}

export async function removeSealAction(userId: string): Promise<void> {
  await assertSameOrigin();

  const ctx = await useCaseContext(await currentActor());
  await removeSeal(ctx, userId);

  revalidatePath(`/doctors/${userId}`);
}

/* -------------------------------------------------------------------------- */
/* Account update requests (§3)                                                */
/* -------------------------------------------------------------------------- */

export async function approveUpdateRequestAction(formData: FormData): Promise<void> {
  await assertSameOrigin();

  const actor = await currentActor();
  const ctx = await useCaseContext(actor);
  const result = await approveUpdateRequest(ctx, formValue(formData, 'requestId'));

  revalidatePath('/updates');
  if (!result.ok) redirect(`/updates?problem=${encodeURIComponent(result.error.message)}`);
}

export async function rejectUpdateRequestAction(formData: FormData): Promise<void> {
  await assertSameOrigin();

  const actor = await currentActor();
  const ctx = await useCaseContext(actor);
  const result = await rejectUpdateRequest(
    ctx,
    formValue(formData, 'requestId'),
    formValue(formData, 'adminNote'),
  );

  revalidatePath('/updates');
  if (!result.ok) redirect(`/updates?problem=${encodeURIComponent(result.error.message)}`);
}
