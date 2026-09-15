'use client';

import { useFormStatus } from 'react-dom';

import { Button } from '@blood-connect/ui';

import { dischargeAction, startRequestAction } from './hospital-actions';

/**
 * The submit half of one of these tiny action forms.
 *
 * `useFormStatus` returns pending only while the enclosing `<form>` is
 * awaiting the server action, so this component works verbatim inside
 * either wrapper below.
 */
function Submit({
  label,
  busy,
  variant,
}: {
  label: string;
  busy: string;
  variant: 'secondary' | 'ghost';
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size="sm" loading={pending}>
      {pending ? busy : label}
    </Button>
  );
}

export function StartRequestButton({ admissionId }: { admissionId: string }) {
  return (
    <form action={startRequestAction.bind(null, admissionId)}>
      <Submit label="New request" busy="Opening…" variant="secondary" />
    </form>
  );
}

export function DischargeButton({ admissionId }: { admissionId: string }) {
  return (
    <form action={dischargeAction.bind(null, admissionId)}>
      <Submit label="Discharge" busy="Discharging…" variant="ghost" />
    </form>
  );
}
