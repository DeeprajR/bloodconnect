'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, FormField, TextInput } from '@blood-connect/ui';

import type { FormState } from './actions';

const initial: FormState = { error: null };

/* -------------------------------------------------------------------------- */
/* Shared kit helpers for every form in this file (ADR 0015).                 */
/* -------------------------------------------------------------------------- */

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} className="w-full">
      {pending ? busy : label}
    </Button>
  );
}

function Problem({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
    >
      {message}
    </p>
  );
}

function Confirmation({ message }: { message: string }) {
  return (
    <p
      role="status"
      className="rounded-control border border-success/30 bg-success-soft px-3 py-2 text-sm text-ink"
    >
      {message}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Forms                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The one place a password is chosen or re-chosen.
 *
 * The minimum is stated up front rather than only on rejection: a rule a
 * person discovers by failing is a rule that wastes their time.
 */
export function ChoosePasswordForm({
  action,
  minimumLength,
  label,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  minimumLength: number;
  label: string;
}) {
  const [state, formAction] = useActionState(action, initial);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Problem message={state.error} />
      <FormField
        label="New password"
        hint={`At least ${String(minimumLength)} characters. A phrase you can remember beats a short, complicated one.`}
        required
      >
        {(props) => (
          <TextInput
            {...props}
            name="password"
            type="password"
            autoComplete="new-password"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        )}
      </FormField>
      <Submit label={label} busy="Working…" />
    </form>
  );
}

export function RequestResetForm({
  action,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const [state, formAction] = useActionState(action, initial);

  if (state.done) {
    return (
      <Confirmation message="If that address has an account, a six-digit code is on its way. It expires in ten minutes." />
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Problem message={state.error} />
      <FormField label="Email address" required>
        {(props) => (
          <TextInput
            {...props}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        )}
      </FormField>
      <Submit label="Send me a code" busy="Sending…" />
    </form>
  );
}

export function CompleteResetForm({
  action,
  minimumLength,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  minimumLength: number;
}) {
  const [state, formAction] = useActionState(action, initial);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Problem message={state.error} />
      <FormField label="Email address" required>
        {(props) => (
          <TextInput
            {...props}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        )}
      </FormField>
      <FormField label="Six-digit code" hint="From the email we just sent." required>
        {(props) => (
          <TextInput
            {...props}
            name="otp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
          />
        )}
      </FormField>
      <FormField
        label="New password"
        hint={`At least ${String(minimumLength)} characters.`}
        required
      >
        {(props) => (
          <TextInput
            {...props}
            name="password"
            type="password"
            autoComplete="new-password"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        )}
      </FormField>
      <Submit label="Set the new password" busy="Working…" />
    </form>
  );
}

export function RequestEmailChangeForm({
  action,
  currentEmail,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  currentEmail: string;
}) {
  const [state, formAction] = useActionState(action, initial);

  if (state.done) {
    return (
      <Confirmation message="Check the new address for a confirmation link. Your account keeps its current address until you open it." />
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Problem message={state.error} />
      <FormField
        label="New email address"
        hint={`Currently ${currentEmail}. We will send a link to the new address, and tell the old one.`}
        required
      >
        {(props) => (
          <TextInput
            {...props}
            name="email"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        )}
      </FormField>
      <Submit label="Send the confirmation" busy="Sending…" />
    </form>
  );
}
