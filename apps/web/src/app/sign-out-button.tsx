'use client';

import { useFormStatus } from 'react-dom';

import { signOutAction } from './actions';

function Submit() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className="ux4g-btn ux4g-btn-outline-neutral ux4g-btn-md app-target"
      disabled={pending}
      aria-disabled={pending}
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Submit />
    </form>
  );
}
