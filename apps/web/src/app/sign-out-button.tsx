'use client';

import { useFormStatus } from 'react-dom';

import { Button } from '@blood-connect/ui';

import { signOutAction } from './actions';

function Submit() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="ghost" size="sm" loading={pending}>
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Submit />
    </form>
  );
}
