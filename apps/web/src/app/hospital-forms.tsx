'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { BLOOD_GROUPS, PRODUCTS, WORDING, bloodGroupLabel, productLabel } from '@blood-connect/domain';

import {
  createAdmissionAction,
  createPatientAction,
  saveDraftAction,
  submitRequestAction,
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
const productOptions = PRODUCTS.map((p) => ({ value: p, label: productLabel(p) }));

/* -------------------------------------------------------------------------- */

export function PatientForm() {
  const [state, action] = useActionState(createPatientAction, initial);
  // The reaction field exists only where there was a previous transfusion —
  // asking about a reaction to something that never happened is noise.
  const [previous, setPrevious] = useState('unknown');

  return (
    <form action={action} className="app-stack" noValidate>
      <Problem message={state.error} />

      <Field id="name" label={WORDING.patientName} required />

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

export function DraftForm({
  requestUuid,
  indication,
  dateRequired,
  bloodGroup,
  product,
  units,
}: {
  requestUuid: string;
  indication: string;
  dateRequired: string;
  bloodGroup: string;
  product: string;
  units: number;
}) {
  const [state, action] = useActionState(saveDraftAction.bind(null, requestUuid), initial);

  return (
    <form action={action} className="app-stack" noValidate>
      <Problem message={state.error} />
      <TextArea
        id="indication"
        label={WORDING.indication}
        defaultValue={indication}
        required
      />
      <Field
        id="dateRequired"
        label={WORDING.dateRequired}
        type="date"
        defaultValue={dateRequired}
        required
      />
      <Select
        id="bloodGroup"
        label={WORDING.requestedBloodGroup}
        options={groupOptions}
        defaultValue={bloodGroup}
      />
      <Select
        id="product"
        label={WORDING.product}
        options={productOptions}
        defaultValue={product}
      />
      <Field
        id="units"
        label={WORDING.units}
        type="number"
        inputMode="numeric"
        min="1"
        defaultValue={String(units)}
        required
      />
      <Submit label="Review" busy="Saving…" />
    </form>
  );
}

/** The review screen takes no input beyond a single Submit (input-fields). */
export function SubmitForm({ requestUuid }: { requestUuid: string }) {
  const [state, action] = useActionState(
    submitRequestAction.bind(null, requestUuid),
    initial,
  );

  return (
    <form action={action} className="app-stack" noValidate>
      <Problem message={state.error} />
      <Submit label="Submit to the blood centre" busy="Submitting…" />
    </form>
  );
}
