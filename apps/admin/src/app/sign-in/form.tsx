'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, FormField, TextInput } from '@blood-connect/ui';

import { signInAction, type FormState } from '../actions';

const initial: FormState = { error: null };

function Submit() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" loading={pending} className="w-full">
      {pending ? 'Signing in…' : 'Sign in'}
    </Button>
  );
}

export function SignInForm() {
  const [state, action] = useActionState(signInAction, initial);

  return (
    <form action={action} className="space-y-4" noValidate>
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
