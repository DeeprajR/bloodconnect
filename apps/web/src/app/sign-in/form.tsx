'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, FormField, TextInput } from '@blood-connect/ui';

import { signInAction, type SignInFormState } from '../actions';

const initialState: SignInFormState = { error: null };

/**
 * The sign-in form.
 *
 * `useActionState` drives the server action; `useFormStatus`, on a nested
 * child, drives the submit button's `loading` state. The server action itself
 * (`signInAction`) is untouched by the restyle — this file only swaps UX4G
 * classes and `<input>` chrome for `FormField` + `TextInput` + `Button` from
 * `@blood-connect/ui` (ADR 0015).
 */
function Submit() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" loading={pending} className="w-full">
      {pending ? 'Signing in…' : 'Sign in'}
    </Button>
  );
}

export function SignInForm() {
  const [state, formAction] = useActionState(signInAction, initialState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {/*
        One message for a wrong address, a wrong password, a deactivated
        account and one never activated (§15). role="alert" so it is
        announced the moment it appears rather than only being visible.
      */}
      {state.error ? (
        <p
          role="alert"
          className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {state.error}
        </p>
      ) : null}

      <FormField label="Email address" required>
        {(props) => (
          <TextInput
            {...props}
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        )}
      </FormField>

      <FormField label="Password" required>
        {(props) => (
          <TextInput
            {...props}
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        )}
      </FormField>

      <Submit />
    </form>
  );
}
