'use client';

import { useFormStatus } from 'react-dom';

import { dischargeAction, startRequestAction } from './hospital-actions';

function Pending({ label, busy, variant }: { label: string; busy: string; variant: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={`ux4g-btn ${variant} ux4g-btn-sm app-target`}
      disabled={pending}
      aria-disabled={pending}
    >
      {pending ? busy : label}
    </button>
  );
}

export function StartRequestButton({ admissionId }: { admissionId: string }) {
  return (
    <form action={startRequestAction.bind(null, admissionId)}>
      <Pending label="New request" busy="Opening…" variant="ux4g-btn-outline-primary" />
    </form>
  );
}

export function DischargeButton({ admissionId }: { admissionId: string }) {
  return (
    <form action={dischargeAction.bind(null, admissionId)}>
      <Pending label="Discharge" busy="Discharging…" variant="ux4g-btn-outline-neutral" />
    </form>
  );
}
