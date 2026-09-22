'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, FormField, TextInput } from '@blood-connect/ui';

import {
  changeDoctorEmailAction,
  createDoctorAction,
  updateDoctorAction,
  uploadSealAction,
  type FormState,
} from './actions';

const initial: FormState = { error: null };

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
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

function Saved({ shown }: { shown: boolean }) {
  if (!shown) return null;
  return (
    <p
      role="status"
      className="rounded-control border border-success/30 bg-success-soft px-3 py-2 text-sm text-ink"
    >
      Saved.
    </p>
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
    <form action={action} className="space-y-4" noValidate>
      <Problem message={state.error} />

      <FormField label="Full name" required>
        {(p) => <TextInput {...p} name="fullName" required />}
      </FormField>

      <FormField
        label="Email address"
        hint="The invite goes here. The doctor sets their own password from it."
        required
      >
        {(p) => <TextInput {...p} name="email" type="email" required />}
      </FormField>

      <FormField
        label="Provisional registration number"
        hint="Optional. Must be unique across doctors."
      >
        {(p) => <TextInput {...p} name="provisionalReg" />}
      </FormField>

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
    <form action={action} className="space-y-4" noValidate>
      <Problem message={state.error} />
      <Saved shown={state.done === true} />

      <FormField label="Full name" required>
        {(p) => <TextInput {...p} name="fullName" defaultValue={fullName} required />}
      </FormField>

      <FormField label="Provisional registration number">
        {(p) => (
          <TextInput {...p} name="provisionalReg" defaultValue={provisionalReg ?? ''} />
        )}
      </FormField>

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
    <form action={action} className="space-y-4" noValidate>
      <Problem message={state.error} />
      <Saved shown={state.done === true} />

      <FormField
        label="Email address"
        hint="Changing this here applies immediately, and tells the old address."
        required
      >
        {(p) => (
          <TextInput {...p} name="email" type="email" defaultValue={currentEmail} required />
        )}
      </FormField>

      <Submit label="Change address" busy="Changing…" />
    </form>
  );
}

export function SealForm({ userId }: { userId: string }) {
  const [state, action] = useActionState(uploadSealAction.bind(null, userId), initial);

  return (
    <form action={action} className="space-y-4" noValidate>
      <Problem message={state.error} />
      <Saved shown={state.done === true} />

      <FormField
        label="Seal image"
        hint="PNG only, 1 MB or smaller. Stored privately and shown only to signed-in staff."
        required
      >
        {(p) => <TextInput {...p} name="seal" type="file" accept="image/png" required />}
      </FormField>

      <Submit label="Upload seal" busy="Uploading…" />
    </form>
  );
}
