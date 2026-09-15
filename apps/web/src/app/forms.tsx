'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, FormField, TextInput } from '@blood-connect/ui';

import type { FormState } from './actions';

const initial: FormState = { error: null };

/* -------------------------------------------------------------------------- */
/* UX4G helpers, exported for the reset flow pages that still ship UX4G       */
/* chrome. Ported one page at a time (ADR 0015).                              */
/* -------------------------------------------------------------------------- */

export function SubmitButton({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className="ux4g-btn ux4g-btn-primary ux4g-btn-lg app-target"
      disabled={pending}
      aria-disabled={pending}
    >
      {pending ? busy : label}
    </button>
  );
}

export function Problem({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <div className="ux4g-alert ux4g-alert-error" role="alert">
      <div className="ux4g-alert-content">
        <p className="ux4g-alert-message">{message}</p>
      </div>
    </div>
  );
}

export function Confirmation({ message }: { message: string }) {
  return (
    <div className="ux4g-alert ux4g-alert-success" role="status">
      <div className="ux4g-alert-content">
        <p className="ux4g-alert-message">{message}</p>
      </div>
    </div>
  );
}

export function Field({
  id,
  label,
  type = 'text',
  autoComplete,
  hint,
  defaultValue,
  inputMode,
  required = true,
}: {
  id: string;
  label: string;
  type?: string;
  autoComplete?: string;
  hint?: string;
  defaultValue?: string;
  inputMode?: 'text' | 'email' | 'numeric';
  required?: boolean;
}) {
  return (
    <div className="ux4g-form-group app-stack-tight">
      <label className="ux4g-label-l-strong" htmlFor={id}>
        {label}
      </label>
      <input
        className="ux4g-input ux4g-input-lg"
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        inputMode={inputMode}
        defaultValue={defaultValue}
        autoCapitalize="none"
        spellCheck={false}
        required={required}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint ? (
        <p className="ux4g-label-m-default" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

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
    <form action={formAction} className="app-stack" noValidate>
      <Problem message={state.error} />
      <Field
        id="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        hint={`At least ${String(minimumLength)} characters. A phrase you can remember beats a short, complicated one.`}
      />
      <SubmitButton label={label} busy="Working…" />
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
    <form action={formAction} className="app-stack" noValidate>
      <Problem message={state.error} />
      <Field
        id="email"
        label="Email address"
        type="email"
        inputMode="email"
        autoComplete="username"
      />
      <SubmitButton label="Send me a code" busy="Sending…" />
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
    <form action={formAction} className="app-stack" noValidate>
      <Problem message={state.error} />
      <Field
        id="email"
        label="Email address"
        type="email"
        inputMode="email"
        autoComplete="username"
      />
      <Field
        id="otp"
        label="Six-digit code"
        inputMode="numeric"
        autoComplete="one-time-code"
        hint="From the email we just sent."
      />
      <Field
        id="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        hint={`At least ${String(minimumLength)} characters.`}
      />
      <SubmitButton label="Set the new password" busy="Working…" />
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Kit-native form (ADR 0015). Used by /profile which was ported in PR-05.    */
/* -------------------------------------------------------------------------- */

function KitSubmit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {pending ? busy : label}
    </Button>
  );
}

function KitProblem({ message }: { message: string | null }) {
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

function KitConfirmation({ message }: { message: string }) {
  return (
    <p
      role="status"
      className="rounded-control border border-success/30 bg-success-soft px-3 py-2 text-sm text-ink"
    >
      {message}
    </p>
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
      <KitConfirmation message="Check the new address for a confirmation link. Your account keeps its current address until you open it." />
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <KitProblem message={state.error} />
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
      <KitSubmit label="Send the confirmation" busy="Sending…" />
    </form>
  );
}
