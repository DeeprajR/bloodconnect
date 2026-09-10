'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  changeDoctorEmailAction,
  createDoctorAction,
  signInAction,
  updateDoctorAction,
  uploadSealAction,
  type FormState,
} from './actions';

const initial: FormState = { error: null };

function Submit({ label, busy }: { label: string; busy: string }) {
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

function Problem({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="ux4g-alert ux4g-alert-error" role="alert">
      <div className="ux4g-alert-content">
        <p className="ux4g-alert-message">{message}</p>
      </div>
    </div>
  );
}

function Saved({ shown }: { shown: boolean }) {
  if (!shown) return null;
  return (
    <div className="ux4g-alert ux4g-alert-success" role="status">
      <div className="ux4g-alert-content">
        <p className="ux4g-alert-message">Saved.</p>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  type = 'text',
  hint,
  defaultValue,
  required = true,
  autoComplete,
}: {
  id: string;
  label: string;
  type?: string;
  hint?: string;
  defaultValue?: string;
  required?: boolean;
  autoComplete?: string;
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
        defaultValue={defaultValue}
        required={required}
        autoComplete={autoComplete}
        spellCheck={false}
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

export function SignInForm() {
  const [state, action] = useActionState(signInAction, initial);

  return (
    <form action={action} className="app-stack" noValidate>
      <Problem message={state.error} />
      <Field id="email" label="Email address" type="email" autoComplete="username" />
      <Field
        id="password"
        label="Password"
        type="password"
        autoComplete="current-password"
      />
      <Submit label="Sign in" busy="Signing in…" />
    </form>
  );
}

/**
 * Creating a doctor sends the invite. There is no password field, because at
 * this moment no password exists. The doctor sets one from a link that only
 * their inbox receives (§2.3).
 */
export function CreateDoctorForm() {
  const [state, action] = useActionState(createDoctorAction, initial);

  return (
    <form action={action} className="app-stack" noValidate>
      <Problem message={state.error} />
      <Field id="fullName" label="Full name" />
      <Field
        id="email"
        label="Email address"
        type="email"
        hint="The invite goes here. The doctor sets their own password from it."
      />
      <Field
        id="provisionalReg"
        label="Provisional registration number"
        required={false}
        hint="Optional. Must be unique across doctors."
      />
      <Submit label="Create and send invite" busy="Creating…" />
    </form>
  );
}

export function EditDoctorForm({
  userId,
  fullName,
  provisionalReg,
}: {
  userId: string;
  fullName: string;
  provisionalReg: string | null;
}) {
  const [state, action] = useActionState(updateDoctorAction.bind(null, userId), initial);

  return (
    <form action={action} className="app-stack" noValidate>
      <Problem message={state.error} />
      <Saved shown={state.done === true} />
      <Field id="fullName" label="Full name" defaultValue={fullName} />
      <Field
        id="provisionalReg"
        label="Provisional registration number"
        defaultValue={provisionalReg ?? ''}
        required={false}
      />
      <Submit label="Save details" busy="Saving…" />
    </form>
  );
}

export function ChangeEmailForm({
  userId,
  currentEmail,
}: {
  userId: string;
  currentEmail: string;
}) {
  const [state, action] = useActionState(
    changeDoctorEmailAction.bind(null, userId),
    initial,
  );

  return (
    <form action={action} className="app-stack" noValidate>
      <Problem message={state.error} />
      <Saved shown={state.done === true} />
      <Field
        id="email"
        label="Email address"
        type="email"
        defaultValue={currentEmail}
        hint="Changing this here applies immediately, and tells the old address."
      />
      <Submit label="Change address" busy="Changing…" />
    </form>
  );
}

export function SealForm({ userId }: { userId: string }) {
  const [state, action] = useActionState(uploadSealAction.bind(null, userId), initial);

  return (
    <form action={action} className="app-stack" noValidate>
      <Problem message={state.error} />
      <Saved shown={state.done === true} />
      <div className="ux4g-form-group app-stack-tight">
        <label className="ux4g-label-l-strong" htmlFor="seal">
          Seal image
        </label>
        <input
          className="ux4g-input ux4g-input-lg"
          id="seal"
          name="seal"
          type="file"
          accept="image/png"
          required
          aria-describedby="seal-hint"
        />
        <p className="ux4g-label-m-default" id="seal-hint">
          PNG only, 1 MB or smaller. Stored privately and shown only to signed-in staff.
        </p>
      </div>
      <Submit label="Upload seal" busy="Uploading…" />
    </form>
  );
}
