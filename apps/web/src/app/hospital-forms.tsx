'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  Button,
  FormField,
  TextArea,
  TextInput,
} from '@blood-connect/ui';

import { WORDING } from '@blood-connect/domain';

import {
  cancelRequestAction,
  createAdmissionAction,
  recordSampleAction,
  type FormState,
} from './hospital-actions';

const initial: FormState = { error: null };

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

export function AdmissionForm({ patientId }: { patientId: string }) {
  const [state, action] = useActionState(
    createAdmissionAction.bind(null, patientId),
    initial,
  );

  return (
    <form action={action} className="space-y-4" noValidate>
      <KitProblem message={state.error} />

      <FormField
        label={WORDING.ipNumber}
        hint="The admission’s identity on the ward. It cannot be changed afterwards."
        required
      >
        {(p) => <TextInput {...p} name="ipNo" required />}
      </FormField>
      <FormField label={WORDING.ward} required>
        {(p) => <TextInput {...p} name="ward" required />}
      </FormField>
      <FormField label={WORDING.admittedAt} hint="Leave blank for now.">
        {(p) => <TextInput {...p} name="admittedAt" type="datetime-local" />}
      </FormField>

      <KitSubmit label="Create admission" busy="Creating…" />
    </form>
  );
}

/**
 * Cancelling a submitted request (§3).
 *
 * Behind a disclosure rather than a button on the page, because this is the
 * one post-submit action and it reaches people: the centre may already have
 * pulled units, and a donor may already have agreed to come in. Opening it
 * first is a moment to be sure.
 *
 * The reason is required by the use case, not only by the form, but asking
 * for it here, before the button, is what makes it a sentence somebody
 * writes rather than a field they fill.
 */
export function CancelRequestForm({
  requestUuid,
  hasDecision,
}: {
  requestUuid: string;
  hasDecision: boolean;
}) {
  const [state, action] = useActionState(
    cancelRequestAction.bind(null, requestUuid),
    initial,
  );
  const [open, setOpen] = useState(false);

  if (state.done === true) {
    return (
      <p
        role="status"
        className="rounded-control border border-success/30 bg-success-soft px-3 py-2 text-sm text-ink"
      >
        Cancelled. The centre has been told
        {hasDecision ? ', any units held for it are back on the shelf,' : ''}{' '}
        and every donor who had agreed to come is being stood down.
      </p>
    );
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="danger"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        Cancel this request
      </Button>
    );
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      <KitProblem message={state.error} />

      <p
        role="status"
        className="rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-ink"
      >
        {hasDecision
          ? 'Any units the centre is holding go back on the shelf, and every donor who agreed to give for this patient is told not to travel.'
          : 'The centre stops working on this, and every donor who agreed to give for this patient is told not to travel.'}
      </p>

      <FormField
        label="Why is it being cancelled?"
        hint="The blood centre sees this. The patient improved, died, was referred, or it was raised in error."
        required
      >
        {(props) => <TextArea {...props} name="reason" rows={2} required />}
      </FormField>

      <div className="flex flex-wrap gap-2">
        <KitSubmit label="Cancel the request" busy="Cancelling…" />
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setOpen(false);
          }}
        >
          Keep it
        </Button>
      </div>
    </form>
  );
}

/**
 * Recording a compatibility testing sample (§3).
 *
 * The identifier field is first and alone, because it is the one thing that
 * has to be copied exactly off the tube. The collection time defaults to
 * now, which is right almost always and editable when a tube is registered
 * late.
 */
export function SampleForm({ requestUuid }: { requestUuid: string }) {
  const [state, action] = useActionState(
    recordSampleAction.bind(null, requestUuid),
    initial,
  );

  return (
    <form
      action={action}
      className="space-y-4"
      noValidate
      key={state.done ? 'done' : 'new'}
    >
      <KitProblem message={state.error} />

      <FormField
        label="Sample identifier"
        hint="Exactly as printed on the tube. It is unique across the whole hospital."
        required
      >
        {(props) => (
          <TextInput {...props} name="sampleIdentifier" type="text" required />
        )}
      </FormField>

      <FormField label="Collected at" hint="Leave blank for now.">
        {(props) => (
          <TextInput {...props} name="collectedAt" type="datetime-local" />
        )}
      </FormField>

      <FormField label="Note">
        {(props) => <TextInput {...props} name="note" type="text" />}
      </FormField>

      <KitSubmit label="Record the sample" busy="Recording…" />
    </form>
  );
}
