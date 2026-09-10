'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';

import { db } from '@blood-connect/platform';

import { useCaseContext } from '@/lib/guards';
import {
  SESSION_COOKIE,
  assertSameOrigin,
  readSessionToken,
  sessionCookieOptions,
} from '@/lib/session';
import { currentActor } from '@/lib/session';
import {
  anonymousActor,
  cancelPendingEmailChange,
  consumeInvite,
  drainEmailOutbox,
  landingFor,
  nodeTokens,
  UPDATE_REQUEST_FIELDS,
  requestAccountUpdate,
  requestEmailChange,
  requestPasswordOtp,
  signIn,
  signOut,
  smtpEmailPort,
  verifyOtpAndReset,
  withdrawAccountUpdate,
} from '@blood-connect/platform';

/**
 * Server actions (§9.1).
 *
 * The rule that matters: a server action parses its input with Zod and calls
 * exactly one use case. No business logic lives in `app/` (§3), everything
 * below is boundary work.
 */

const signInSchema = z.object({
  // `.trim()` and not `.email()`: an address that fails our idea of valid must
  // reach the use case anyway, so the response stays identical to a wrong
  // password and the form does not become an enumeration oracle (§15).
  email: z.string().trim().min(1, 'Enter your email address.').max(320),
  password: z.string().min(1, 'Enter your password.').max(1024),
});

export type SignInFormState = { readonly error: string | null };

export async function signInAction(
  _previous: SignInFormState,
  formData: FormData,
): Promise<SignInFormState> {
  await assertSameOrigin();

  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const ctx = await useCaseContext(anonymousActor);
  const result = await signIn(ctx, { ...parsed.data, audience: 'staff' });

  if (!result.ok) {
    return { error: result.error.message };
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, result.value.token, sessionCookieOptions(result.value.expiresAt));

  // Signing in lands them on the dashboard for their role, never on a menu
  // and never back on the form they just completed (§3).
  redirect(landingFor(result.value.user.role));
}

export async function signOutAction(): Promise<void> {
  await assertSameOrigin();

  const token = await readSessionToken();
  if (token) {
    const actor = await currentActor();
    const ctx = await useCaseContext(actor);
    await signOut(ctx, nodeTokens.fingerprint(token));
  }

  const store = await cookies();
  store.delete(SESSION_COOKIE);

  redirect('/sign-in');
}

/* -------------------------------------------------------------------------- */
/* Activation, reset and address change                                        */
/* -------------------------------------------------------------------------- */

const passwordSchema = z.object({
  password: z.string().min(1, 'Choose a password.').max(1024),
});

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

/**
 * Setting the password from an invite signs them in (§3).
 *
 * The redirect is the ending §8 names for this flow, never back to a sign-in
 * form to retype what they just chose.
 */
export async function activateAction(
  token: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const parsed = passwordSchema.safeParse({ password: formData.get('password') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Choose a password.' };
  }

  const ctx = await useCaseContext(anonymousActor);
  const result = await consumeInvite(ctx, token, parsed.data.password);
  if (!result.ok) return { error: result.error.message };

  const store = await cookies();
  store.set(SESSION_COOKIE, result.value.token, sessionCookieOptions(result.value.expiresAt));

  after(() => drainEmailOutbox(db, smtpEmailPort, new Date()));
  redirect(landingFor(result.value.role));
}

export async function requestResetAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const email = formValue(formData, 'email');
  const ctx = await useCaseContext(anonymousActor);
  const result = await requestPasswordOtp(ctx, email);

  after(() => drainEmailOutbox(db, smtpEmailPort, new Date()));

  // Throttling is the only visible failure. Everything else answers the same
  // whether or not the address exists (§3).
  if (!result.ok) return { error: result.error.message };
  return { error: null, done: true };
}

export async function completeResetAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const email = formValue(formData, 'email');
  const otp = formValue(formData, 'otp').trim();
  const password = formValue(formData, 'password');

  const ctx = await useCaseContext(anonymousActor);
  const result = await verifyOtpAndReset(ctx, email, otp, password);
  if (!result.ok) return { error: result.error.message };

  const store = await cookies();
  store.set(SESSION_COOKIE, result.value.token, sessionCookieOptions(result.value.expiresAt));

  after(() => drainEmailOutbox(db, smtpEmailPort, new Date()));
  redirect(landingFor(result.value.role));
}

export async function requestEmailChangeAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const actor = await currentActor();
  const ctx = await useCaseContext(actor);
  const result = await requestEmailChange(ctx, formValue(formData, 'email'));

  after(() => drainEmailOutbox(db, smtpEmailPort, new Date()));

  if (!result.ok) return { error: result.error.message };
  return { error: null, done: true };
}

export async function cancelEmailChangeAction(): Promise<void> {
  await assertSameOrigin();

  const actor = await currentActor();
  const ctx = await useCaseContext(actor);
  await cancelPendingEmailChange(ctx);

  revalidatePath('/profile');
}

/* -------------------------------------------------------------------------- */
/* Account update requests (§3)                                                */
/* -------------------------------------------------------------------------- */

const updateRequestSchema = z.object({
  field: z.enum(UPDATE_REQUEST_FIELDS),
  proposedValue: z.string().trim().min(1, 'Fill in the new value.').max(200),
  reason: z
    .string()
    .trim()
    .min(1, 'Say why it needs changing.')
    .max(500, 'Keep it under 500 characters.'),
});

export async function requestAccountUpdateAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const parsed = updateRequestSchema.safeParse({
    field: formData.get('field'),
    proposedValue: formData.get('proposedValue'),
    reason: formData.get('reason'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  }

  const actor = await currentActor();
  const ctx = await useCaseContext(actor);
  const result = await requestAccountUpdate(ctx, parsed.data);

  if (!result.ok) return { error: result.error.message };

  revalidatePath('/profile');
  return { error: null, done: true };
}

export async function withdrawAccountUpdateAction(formData: FormData): Promise<void> {
  await assertSameOrigin();

  const actor = await currentActor();
  const ctx = await useCaseContext(actor);
  await withdrawAccountUpdate(ctx, formValue(formData, 'requestId'));

  revalidatePath('/profile');
}
