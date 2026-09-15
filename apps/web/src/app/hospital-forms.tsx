'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { WORDING } from '@blood-connect/domain';

import {
  cancelRequestAction,
  createAdmissionAction,
  recordSampleAction,
  type FormState,
} from './hospital-actions';

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

function Field({
  id,
  label,
  type = 'text',
  hint,
  defaultValue,
  required = false,
  inputMode,
  min,
}: {
  id: string;
  label: string;
  type?: string;
  hint?: string;
  defaultValue?: string;
  required?: boolean;
  inputMode?: 'text' | 'numeric' | 'tel';
  min?: string;
}) {
  return (
    <div className="ux4g-form-group app-stack-tight">
      <label className="ux4g-label-l-strong" htmlFor={id}>
        {label}
        {required ? '' : <span className="ux4g-label-m-default"> (optional)</span>}
      </label>
      <input
        className="ux4g-input ux4g-input-lg"
        id={id}
        name={id}
        type={type}
        inputMode={inputMode}
        defaultValue={defaultValue}
        required={required}
        min={min}
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

/*
 * `PatientForm` moved to `patients/new/form.tsx` in PR-04 of the UX4G-
 * replacement track (ADR 0015). It is the only form here whose page has
 * been ported to the kit, and colocating it with that page keeps the kit-
 * styled version isolated from the UX4G-styled forms below.
 *
 * The shared helpers above (`Submit`, `Problem`, `Field`) still power the
 * three remaining UX4G forms below and will lose their UX4G classes when
 * those forms' pages are ported one at a time.
 */

export function AdmissionForm({ patientId }: { patientId: string }) {
  const [state, action] = useActionState(
    createAdmissionAction.bind(null, patientId),
    initial,
  );

  return (
    <form action={action} className="app-stack" noValidate>
      <Problem message={state.error} />
      <Field
        id="ipNo"
        label={WORDING.ipNumber}
        required
        hint="The admission’s identity on the ward. It cannot be changed afterwards."
      />
      <Field id="ward" label={WORDING.ward} required />
      <Field
        id="admittedAt"
        label={WORDING.admittedAt}
        type="datetime-local"
        hint="Leave blank for now."
      />
      <Submit label="Create admission" busy="Creating…" />
    </form>
  );
}

/*
 * `DraftForm` and `SubmitForm` lived here.
 *
 * A request is four fields on one screen now (`RaiseRequestForm`), so
 * there is no draft to edit and no review step to confirm. The review was
 * four fields shown back to somebody who had just typed them (ADR 0010).
 */

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
      <div className="ux4g-alert ux4g-alert-success" role="status">
        <div className="ux4g-alert-content">
          <p className="ux4g-alert-message">
            Cancelled. The centre has been told
            {hasDecision ? ', any units held for it are back on the shelf,' : ''} and
            every donor who had agreed to come is being stood down.
          </p>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className="ux4g-btn ux4g-btn-outline-danger ux4g-btn-md app-target"
        onClick={() => {
          setOpen(true);
        }}
      >
        Cancel this request
      </button>
    );
  }

  return (
    <form action={action} className="app-stack" noValidate>
      <Problem message={state.error} />

      <div className="ux4g-alert ux4g-alert-warning" role="status">
        <div className="ux4g-alert-content">
          <p className="ux4g-alert-message">
            {hasDecision
              ? 'Any units the centre is holding go back on the shelf, and every donor who agreed to give for this patient is told not to travel.'
              : 'The centre stops working on this, and every donor who agreed to give for this patient is told not to travel.'}
          </p>
        </div>
      </div>

      <div className="ux4g-form-group app-stack-tight">
        <label className="ux4g-label-l-strong" htmlFor="reason">
          Why is it being cancelled?
        </label>
        <textarea
          className="ux4g-input ux4g-input-lg"
          id="reason"
          name="reason"
          rows={2}
          required
          aria-describedby="reason-hint"
        />
        <p className="ux4g-label-m-default" id="reason-hint">
          {/* The centre reads this, so "n/a" costs somebody a phone call. */}
          The blood centre sees this. The patient improved, died, was referred,
          or it was raised in error.
        </p>
      </div>

      <div className="app-row">
        <Submit label="Cancel the request" busy="Cancelling…" />
        <button
          type="button"
          className="ux4g-btn ux4g-btn-text-neutral ux4g-btn-md app-target"
          onClick={() => {
            setOpen(false);
          }}
        >
          Keep it
        </button>
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
      className="app-stack"
      noValidate
      key={state.done ? 'done' : 'new'}
    >
      <Problem message={state.error} />

      <Field
        id="sampleIdentifier"
        label="Sample identifier"
        required
        hint="Exactly as printed on the tube. It is unique across the whole hospital."
      />
      <Field
        id="collectedAt"
        label="Collected at"
        type="datetime-local"
        hint="Leave blank for now."
      />
      <Field id="note" label="Note" />

      <Submit label="Record the sample" busy="Recording…" />
    </form>
  );
}
