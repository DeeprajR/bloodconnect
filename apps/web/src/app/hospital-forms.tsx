'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { BLOOD_GROUPS, WORDING, bloodGroupLabel } from '@blood-connect/domain';

import {
  cancelRequestAction,
  createAdmissionAction,
  findDuplicatesAction,
  recordSampleAction,
  createPatientAction,
  type FormState,
} from './hospital-actions';
import type { PossibleDuplicate } from '@blood-connect/hospital';

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

function Select({
  id,
  label,
  options,
  defaultValue,
  required = true,
  onChange,
}: {
  id: string;
  label: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string;
  required?: boolean;
  onChange?: (value: string) => void;
}) {
  return (
    <div className="ux4g-form-group app-stack-tight">
      <label className="ux4g-label-l-strong" htmlFor={id}>
        {label}
      </label>
      <select
        className="ux4g-form-select ux4g-form-select-lg"
        id={id}
        name={id}
        defaultValue={defaultValue}
        required={required}
        onChange={onChange ? (e) => { onChange(e.target.value); } : undefined}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function TextArea({
  id,
  label,
  hint,
  defaultValue,
  required = false,
}: {
  id: string;
  label: string;
  hint?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <div className="ux4g-form-group app-stack-tight">
      <label className="ux4g-label-l-strong" htmlFor={id}>
        {label}
        {required ? '' : <span className="ux4g-label-m-default"> (optional)</span>}
      </label>
      <textarea
        className="ux4g-input ux4g-input-lg"
        id={id}
        name={id}
        rows={3}
        defaultValue={defaultValue}
        required={required}
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

const groupOptions = BLOOD_GROUPS.map((g) => ({ value: g, label: bloodGroupLabel(g) }));

/* -------------------------------------------------------------------------- */

/**
 * Patients who look like this one (§3).
 *
 * **Shown, never enforced.** Two people genuinely called Anitha Menon arrive at
 * the same hospital, and refusing the second admission at 3am is a far worse
 * failure than recording a duplicate. So this is a panel beside the field with
 * enough to recognise somebody, and the doctor decides.
 */
function DuplicateWarning({ matches }: { matches: readonly PossibleDuplicate[] }) {
  if (matches.length === 0) return null;

  return (
    <div className="ux4g-alert ux4g-alert-warning" role="status">
      <div className="ux4g-alert-content">
        <p className="ux4g-alert-message">
          {matches.length === 1
            ? 'A patient with a similar name is already recorded:'
            : `${String(matches.length)} patients with similar names are already recorded:`}
        </p>
        <ul>
          {matches.map((match) => (
            <li key={match.patientId} className="ux4g-body-s-default">
              <strong>{match.name}</strong>
              {match.uhid ? <span className="app-figure"> · {match.uhid}</span> : null}
              <span className="app-figure"> · {match.bloodGroup}</span>
              {match.openAdmission ? (
                <span> · on a ward now, {WORDING.ipNumber} {match.openAdmission}</span>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="ux4g-label-m-default">
          If one of these is the same person, use their existing record. If not,
          carry on. This is only a check.
        </p>
      </div>
    </div>
  );
}

export function PatientForm() {
  const [state, action] = useActionState(createPatientAction, initial);
  // The reaction field exists only where there was a previous transfusion.
  // Asking about a reaction to something that never happened is noise.
  const [previous, setPrevious] = useState('unknown');
  const [duplicates, setDuplicates] = useState<PossibleDuplicate[]>([]);

  /**
   * Checked when the field is left, not on every keystroke.
   *
   * A lookup per character would query the patient table dozens of times for
   * one name, and the warning is only useful once there is a whole name to
   * compare.
   */
  const checkName = (event: React.FocusEvent<HTMLInputElement>): void => {
    const name = event.target.value.trim();
    if (name.length < 3) {
      setDuplicates([]);
      return;
    }
    void findDuplicatesAction(name).then(setDuplicates);
  };

  return (
    <form action={action} className="app-stack" noValidate>
      <Problem message={state.error} />

      <div className="ux4g-form-group app-stack-tight">
        <label className="ux4g-label-l-strong" htmlFor="name">
          {WORDING.patientName}
        </label>
        <input
          className="ux4g-input ux4g-input-lg"
          id="name"
          name="name"
          type="text"
          required
          onBlur={checkName}
        />
      </div>
      <DuplicateWarning matches={duplicates} />

      <Field
        id="dob"
        label={WORDING.dateOfBirth}
        type="date"
        hint="Give this, or an age below. A neonate is usually recorded in days."
      />
      <div className="app-row">
        <Field id="age" label={WORDING.age} type="number" inputMode="numeric" min="0" />
        <Select
          id="ageUnit"
          label="Age unit"
          defaultValue="years"
          required={false}
          options={[
            { value: 'years', label: 'Years' },
            { value: 'months', label: 'Months' },
            { value: 'days', label: 'Days' },
          ]}
        />
      </div>

      <Select
        id="sex"
        label={WORDING.sex}
        options={[
          { value: 'female', label: 'Female' },
          { value: 'male', label: 'Male' },
          { value: 'other', label: 'Other' },
        ]}
      />
      <Select id="bloodGroup" label={WORDING.bloodGroupAndRh} options={groupOptions} />

      <Field id="uhid" label={WORDING.hospitalId} hint="Unique if given." />
      <Field id="attenderName" label={WORDING.attenderName} />
      <Field id="attenderPhone" label={WORDING.attenderPhone} type="tel" inputMode="tel" />
      <TextArea id="address" label="Address" />
      <TextArea id="diagnosis" label={WORDING.knownDiagnosis} />
      <TextArea id="history" label={WORDING.relevantHistory} />

      <Select
        id="previousTransfusion"
        label={WORDING.previousTransfusion}
        defaultValue="unknown"
        onChange={setPrevious}
        options={[
          { value: 'unknown', label: 'Unknown' },
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ]}
      />
      {previous === 'yes' ? (
        <TextArea id="previousReaction" label={WORDING.previousReaction} required />
      ) : null}

      <Submit label="Save patient and admit" busy="Saving…" />
    </form>
  );
}

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
 * A request is four fields on one screen now (`RaiseRequestForm`), so there is
 * no draft to edit and no review step to confirm. The review was four fields
 * shown back to somebody who had just typed them (ADR 0010).
 */

/**
 * Cancelling a submitted request (§3).
 *
 * Behind a disclosure rather than a button on the page, because this is the one
 * post-submit action and it reaches people: the centre may already have pulled
 * units, and a donor may already have agreed to come in. Opening it first is a
 * moment to be sure.
 *
 * The reason is required by the use case, not only by the form, but asking for
 * it here, before the button, is what makes it a sentence somebody writes rather
 * than a field they fill.
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
          The blood centre sees this. The patient improved, died, was referred, or
          it was raised in error.
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
 * The identifier field is first and alone, because it is the one thing that has
 * to be copied exactly off the tube. The collection time defaults to now, which
 * is right almost always and editable when a tube is registered late.
 */
export function SampleForm({ requestUuid }: { requestUuid: string }) {
  const [state, action] = useActionState(
    recordSampleAction.bind(null, requestUuid),
    initial,
  );

  return (
    <form action={action} className="app-stack" noValidate key={state.done ? 'done' : 'new'}>
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
