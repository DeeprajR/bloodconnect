'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { BLOOD_GROUPS, WORDING, bloodGroupLabel } from '@blood-connect/domain';

import { DateParts } from './date-parts';
import { attachPatientAction, type FormState } from './centre-actions';

/**
 * The patient, taken from the bystander at the desk (ADR 0010).
 *
 * The other half of the request slip: a doctor gave four fields and read an ID
 * aloud; somebody carried it here, and this is where the patient finally gets a
 * name. Until it is filled the request cannot be reserved against or issued.
 * Except for an emergency, which may be answered first and completed after.
 *
 * **Four fields are demanded and the rest are offered**, in the order somebody
 * actually asks them: who is this, where are they, how old, what group. The four
 * are what the record cannot exist without. Everything else is worth asking
 * while the person is standing there, which is why it is on the page at all,
 * but behind a disclosure, because it must never be what delays a unit.
 *
 * **A rejected form keeps everything that was typed.** Every field reads its
 * default from `state.values`, which the action echoes back on failure. Before
 * that, missing one required field emptied the whole form, and the person who
 * paid for it was a counter clerk re-asking a bystander for an address they had
 * already given. The disclosure below opens itself when anything inside it
 * survived, so a returned answer is never hidden behind a closed panel.
 */

const initial: FormState = { error: null };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="ux4g-btn ux4g-btn-primary ux4g-btn-lg app-target"
      disabled={pending}
      aria-disabled={pending}
    >
      {pending ? 'Recording…' : 'Record the patient'}
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

function Text({
  id,
  label,
  hint,
  type = 'text',
  required = false,
  inputMode,
  defaultValue = '',
}: {
  id: string;
  label: string;
  hint?: string;
  type?: string;
  required?: boolean;
  inputMode?: 'text' | 'numeric' | 'tel';
  defaultValue?: string;
}) {
  return (
    <div className="ux4g-form-group app-stack-tight">
      <label className="ux4g-label-m-strong" htmlFor={id}>
        {label}
      </label>
      <input
        className="ux4g-input ux4g-input-md"
        id={id}
        name={id}
        type={type}
        inputMode={inputMode}
        required={required}
        defaultValue={defaultValue}
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

function Note({
  id,
  label,
  defaultValue = '',
}: {
  id: string;
  label: string;
  defaultValue?: string;
}) {
  return (
    <div className="ux4g-form-group app-stack-tight">
      <label className="ux4g-label-m-strong" htmlFor={id}>
        {label}
      </label>
      <textarea
        className="ux4g-input ux4g-input-md"
        id={id}
        name={id}
        rows={2}
        defaultValue={defaultValue}
      />
    </div>
  );
}

const groupOptions = BLOOD_GROUPS.map((g) => ({ value: g, label: bloodGroupLabel(g) }));

export function AttachPatientForm({ requestUuid }: { requestUuid: string }) {
  const [state, action] = useActionState(
    attachPatientAction.bind(null, requestUuid),
    initial,
  );

  /** Whatever came back from a rejected submit, or nothing on a first render. */
  const was = (field: string): string => state.values?.[field] ?? '';

  /*
    Open the disclosure if anything inside it survived a rejection. A returned
    answer sitting behind a collapsed panel reads as lost, and somebody types it
    again.
  */
  const extras = [
    'uhid',
    'attenderName',
    'attenderPhone',
    'address',
    'diagnosis',
    'history',
    'previousReaction',
  ];
  const extrasFilled = extras.some((field) => was(field) !== '');

  if (state.done === true) {
    return (
      <div className="ux4g-alert ux4g-alert-success" role="status">
        <div className="ux4g-alert-content">
          <p className="ux4g-alert-message">
            Patient recorded. This request can be answered now.
          </p>
        </div>
      </div>
    );
  }

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
          required
          autoFocus
          defaultValue={was('name')}
        />
      </div>

      <div className="app-row">
        <Text
          id="ipNo"
          label={WORDING.ipNumber}
          required
          hint="From the ward. It identifies the admission."
          defaultValue={was('ipNo')}
        />
        <Text id="ward" label={WORDING.ward} defaultValue={was('ward')} />
      </div>

      <div className="ux4g-form-group app-stack-tight">
        <label className="ux4g-label-l-strong" htmlFor="bloodGroup">
          Patient&rsquo;s own {WORDING.bloodGroupAndRh}
        </label>
        <select
          className="ux4g-form-select ux4g-form-select-lg"
          id="bloodGroup"
          name="bloodGroup"
          defaultValue={was('bloodGroup')}
          required
          aria-describedby="bloodGroup-hint"
        >
          <option value="">Choose</option>
          {groupOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="ux4g-label-m-default" id="bloodGroup-hint">
          {/*
            Not the group on the request. An emergency is often answered with O−
            whatever the patient turns out to be, and recording one as the other
            would put a group nobody measured onto a clinical record.
          */}
          What the patient is, not what was asked for. The centre types every
          unit before it is used.
        </p>
      </div>

      <div className="app-row">
        <Text
          id="age"
          label={WORDING.age}
          type="number"
          inputMode="numeric"
          defaultValue={was('age')}
        />
        <div className="ux4g-form-group app-stack-tight">
          <label className="ux4g-label-m-strong" htmlFor="ageUnit">
            Age unit
          </label>
          <select
            className="ux4g-form-select ux4g-form-select-md"
            id="ageUnit"
            name="ageUnit"
            defaultValue={was('ageUnit') === '' ? 'years' : was('ageUnit')}
          >
            <option value="years">Years</option>
            <option value="months">Months</option>
            <option value="days">Days</option>
          </select>
          <p className="ux4g-label-m-default">
            {/* A neonate is recorded in days, which is why the unit exists. */}
            A newborn is usually recorded in days.
          </p>
        </div>
      </div>

      <DateParts
        id="dob"
        label={WORDING.dateOfBirth}
        defaultValue={was('dob')}
        hint="Give this or the age above. The record needs one of them."
      />

      <div className="ux4g-form-group app-stack-tight">
        <label className="ux4g-label-m-strong" htmlFor="sex">
          {WORDING.sex}
        </label>
        <select
          className="ux4g-form-select ux4g-form-select-md"
          id="sex"
          name="sex"
          defaultValue={was('sex')}
        >
          <option value="">Not stated</option>
          <option value="female">Female</option>
          <option value="male">Male</option>
          <option value="other">Other</option>
        </select>
      </div>

      {/*
        Worth asking while the person is at the desk, but never what delays a
        unit, so it is offered, not demanded.
      */}
      <details className="app-more" open={extrasFilled}>
        <summary className="app-more-summary">
          <span className="app-stack-tight">
            <span>Contact and clinical context</span>
            <span className="ux4g-label-m-default">
              Optional, ask while they are here
            </span>
          </span>
          <svg
            className="app-more-chevron"
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M5 7.5 10 12.5 15 7.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </summary>

        <div className="app-stack app-more-body">
          <Text id="uhid" label={WORDING.hospitalId} defaultValue={was('uhid')} />
          <Text
            id="attenderName"
            label={WORDING.attenderName}
            defaultValue={was('attenderName')}
          />
          <Text
            id="attenderPhone"
            label={WORDING.attenderPhone}
            type="tel"
            inputMode="tel"
            defaultValue={was('attenderPhone')}
          />
          <Note id="address" label="Address" defaultValue={was('address')} />
          <Note id="diagnosis" label={WORDING.knownDiagnosis} defaultValue={was('diagnosis')} />
          <Note id="history" label={WORDING.relevantHistory} defaultValue={was('history')} />

          <div className="ux4g-form-group app-stack-tight">
            <label className="ux4g-label-m-strong" htmlFor="previousTransfusion">
              {WORDING.previousTransfusion}
            </label>
            <select
              className="ux4g-form-select ux4g-form-select-md"
              id="previousTransfusion"
              name="previousTransfusion"
              defaultValue={
                was('previousTransfusion') === '' ? 'unknown' : was('previousTransfusion')
              }
            >
              <option value="unknown">Unknown</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>

          <Note
            id="previousReaction"
            label={WORDING.previousReaction}
            defaultValue={was('previousReaction')}
          />
        </div>
      </details>

      <Submit />
    </form>
  );
}
