'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { signInAction, type SignInFormState } from '../actions';

const initialState: SignInFormState = { error: null };

function Submit() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className="ux4g-btn ux4g-btn-primary ux4g-btn-lg app-target"
      disabled={pending}
      aria-disabled={pending}
    >
      {pending ? 'Signing in…' : 'Sign in'}
    </button>
  );
}

export function SignInForm() {
  const [state, formAction] = useActionState(signInAction, initialState);

  return (
    <form action={formAction} className="app-stack" noValidate>
      {/*
        One message for a wrong address, a wrong password, a deactivated account
        and one never activated (§15). role="alert" so it is announced the
        moment it appears rather than only being visible.
      */}
      {state.error ? (
        <div className="ux4g-alert ux4g-alert-error" role="alert">
          <div className="ux4g-alert-content">
            <p className="ux4g-alert-message">{state.error}</p>
          </div>
        </div>
      ) : null}

      <div className="ux4g-form-group app-stack-tight">
        <label className="ux4g-label-l-strong" htmlFor="email">
          Email address
        </label>
        <input
          className="ux4g-input ux4g-input-lg"
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
      </div>

      <div className="ux4g-form-group app-stack-tight">
        <label className="ux4g-label-l-strong" htmlFor="password">
          Password
        </label>
        <input
          className="ux4g-input ux4g-input-lg"
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      <Submit />
    </form>
  );
}
