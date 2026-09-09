'use client';

import { useActionState, useState } from 'react';

import type { FormState } from './actions';
import { Confirmation, Problem, SubmitButton } from './forms';

const initial: FormState = { error: null };

const FIELDS = [
  { value: 'full_name', label: 'Full name' },
  { value: 'provisional_reg', label: 'Registration number' },
] as const;

/**
 * Asking for the two fields a doctor cannot change themselves (§3).
 *
 * The current value is prefilled into the box, because almost every request
 * here is a correction — a missing initial, a transposed digit — and retyping a
 * long registration number from memory is how a second mistake gets in.
 */
export function RequestUpdateForm({
  action,
  currentName,
  currentReg,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  currentName: string;
  currentReg: string;
}) {
  const [state, formAction] = useActionState(action, initial);
  const [field, setField] = useState<'full_name' | 'provisional_reg'>('full_name');

  if (state.done) {
    return (
      <Confirmation message="Sent to your administrator. You will see it here until it is decided." />
    );
  }

  const current = field === 'full_name' ? currentName : currentReg;

  return (
    <form action={formAction} className="app-stack" noValidate>
      <Problem message={state.error} />

      <fieldset className="ux4g-form-group app-stack-tight">
        <legend className="ux4g-label-l-strong">What needs changing</legend>
        <div className="app-row">
          {FIELDS.map((option) => (
            <label className="app-choice" key={option.value} htmlFor={`field-${option.value}`}>
              <input
                type="radio"
                id={`field-${option.value}`}
                name="field"
                value={option.value}
                checked={field === option.value}
                onChange={() => {
                  setField(option.value);
                }}
              />
              <span className="ux4g-body-m-default">{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="ux4g-form-group app-stack-tight">
        <label className="ux4g-label-l-strong" htmlFor="proposedValue">
          What it should say
        </label>
        <input
          className="ux4g-input ux4g-input-lg"
          id="proposedValue"
          name="proposedValue"
          // Keyed on the field so switching between the two reloads the box
          // with the right current value instead of keeping the other one.
          key={field}
          defaultValue={current}
          maxLength={200}
          required
          aria-describedby="proposedValue-hint"
        />
        <p className="ux4g-label-m-default" id="proposedValue-hint">
          {current ? `Currently ${current}.` : 'Nothing is recorded at the moment.'}
        </p>
      </div>

      <div className="ux4g-form-group app-stack-tight">
        <label className="ux4g-label-l-strong" htmlFor="reason">
          Why
        </label>
        <textarea
          className="ux4g-input"
          id="reason"
          name="reason"
          rows={3}
          maxLength={500}
          required
          aria-describedby="reason-hint"
        />
        <p className="ux4g-label-m-default" id="reason-hint">
          An administrator decides on this, so give them something to decide on.
        </p>
      </div>

      <SubmitButton label="Send the request" busy="Sending…" />
    </form>
  );
}
