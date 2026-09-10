'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  BLOOD_GROUPS,
  PRODUCTS,
  URGENCIES,
  URGENCY_LABELS,
  WORDING,
  bloodGroupLabel,
  productLabel,
} from '@blood-connect/domain';

import { raiseRequestAction, type FormState } from './hospital-actions';

/**
 * The doctor's whole job, on one screen (§3, ADR 0010).
 *
 * **Four inputs, and speed is the requirement.** This is filled at a bedside by
 * somebody handling several patients, often standing up, sometimes with a
 * bleeding patient in front of them. So the four are big, tappable and above
 * the fold, and everything else is behind one disclosure that starts closed.
 *
 * Three consequences of that priority, each deliberate:
 *
 *  1. **Buttons, not dropdowns**, for group, product and urgency. A native
 *     select is two taps and a scroll; a radio grid is one tap and needs no
 *     aim. It costs vertical space, which is the right thing to spend here.
 *  2. **The collapsed section is a native `<details>`.** No JavaScript decides
 *     whether it opens, so it works before hydration and on a bad hospital
 *     connection, and the fields inside are still in the form, so a doctor who
 *     opened it, filled it, and collapsed it again does not lose the answers.
 *  3. **Nothing inside it is required.** Opening it must never be able to stop
 *     the request going through; the centre fills in what is missing when the
 *     bystander arrives with the ID.
 */

const initial: FormState = { error: null };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="ux4g-btn ux4g-btn-primary ux4g-btn-lg app-target app-raise-submit"
      disabled={pending}
      aria-disabled={pending}
    >
      {pending ? 'Sending…' : 'Send to the blood centre'}
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

/**
 * A row of tappable options, as radios.
 *
 * Radios rather than buttons with state: the browser handles selection,
 * keyboard and screen-reader semantics, and the form submits without a single
 * line of JavaScript. The visible control is the label; the input itself is
 * hidden from sight but not from assistive technology.
 */
function ChoiceRow({
  name,
  legend,
  options,
  defaultValue,
  columns,
}: {
  name: string;
  legend: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string;
  columns?: number;
}) {
  return (
    <fieldset className="ux4g-form-group app-stack-tight">
      <legend className="ux4g-label-l-strong">{legend}</legend>
      <div
        className="app-choices"
        style={columns ? { gridTemplateColumns: `repeat(${String(columns)}, 1fr)` } : undefined}
      >
        {options.map((option) => (
          <label className="app-choice" key={option.value}>
            <input
              type="radio"
              name={name}
              value={option.value}
              defaultChecked={option.value === defaultValue}
              required
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Field({
  id,
  label,
  type = 'text',
  hint,
  defaultValue,
  inputMode,
}: {
  id: string;
  label: string;
  type?: string;
  hint?: string;
  defaultValue?: string;
  inputMode?: 'text' | 'numeric' | 'tel';
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

const groupOptions = BLOOD_GROUPS.map((g) => ({ value: g, label: bloodGroupLabel(g) }));
const productOptions = PRODUCTS.map((p) => ({ value: p, label: productLabel(p) }));
const urgencyOptions = URGENCIES.map((u) => ({ value: u, label: URGENCY_LABELS[u] }));
const unitOptions = ['1', '2', '3', '4'].map((n) => ({ value: n, label: n }));

export function RaiseRequestForm({
  admissionId,
  patientName,
}: {
  /** Prefilled when the doctor came from an admitted patient. */
  admissionId?: string | undefined;
  patientName?: string | undefined;
}) {
  const [state, action] = useActionState(raiseRequestAction, initial);
  const [moreUnits, setMoreUnits] = useState(false);

  return (
    <form action={action} className="app-stack" noValidate>
      <Problem message={state.error} />

      {/* ---------------------------------------------------- the four --- */}

      <ChoiceRow
        name="bloodGroup"
        legend={WORDING.requestedBloodGroup}
        options={groupOptions}
        columns={4}
      />

      <ChoiceRow
        name="product"
        legend={WORDING.product}
        options={productOptions}
        defaultValue="prbc"
      />

      <fieldset className="ux4g-form-group app-stack-tight">
        <legend className="ux4g-label-l-strong">{WORDING.units}</legend>
        {moreUnits ? (
          <input
            className="ux4g-input ux4g-input-lg"
            name="units"
            type="number"
            inputMode="numeric"
            min="1"
            defaultValue="5"
            autoFocus
            required
            aria-label={WORDING.units}
          />
        ) : (
          <div className="app-choices" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
            {unitOptions.map((option) => (
              <label className="app-choice" key={option.value}>
                <input type="radio" name="units" value={option.value} required />
                <span>{option.label}</span>
              </label>
            ))}
            {/*
              Four buttons covers almost every request; the fifth swaps in a
              number field rather than putting twenty buttons on the screen.
            */}
            <button
              type="button"
              className="app-choice app-choice-more"
              onClick={() => {
                setMoreUnits(true);
              }}
            >
              5+
            </button>
          </div>
        )}
      </fieldset>

      <ChoiceRow name="urgency" legend="How urgent?" options={urgencyOptions} />

      <Submit />

      {/* ------------------------------------------------ the rest ------- */}
      {/*
        Closed by default, and open when the doctor arrived from an admitted
        patient, the one case where they already have the answers in front of
        them and retyping would be the slow path.
      */}
      <details className="app-more" open={admissionId !== undefined}>
        <summary className="app-more-summary">
          <span className="app-stack-tight">
            <span>Patient and clinical details</span>
            <span className="ux4g-label-m-default">
              Optional, the blood centre fills these in
            </span>
          </span>
          {/*
            The affordance. `display: flex` on a `<summary>` removes the
            browser's own marker, so the chevron is drawn here where it can be
            placed and rotated. Hidden from assistive technology: the
            open/closed state is already on the `<details>` element itself.
          */}
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
          <p className="ux4g-label-m-default">
            {/*
              Said plainly, because a doctor who does not know this will fill in
              twenty fields they did not need to (ADR 0010).
            */}
            Leave all of this to the blood centre. They collect it from the
            patient&rsquo;s bystander at the counter, using the ID you are about to
            get. Fill it in only if you already have it to hand.
          </p>

          {admissionId === undefined ? null : (
            <input type="hidden" name="admissionId" value={admissionId} />
          )}

          {patientName === undefined ? null : (
            <p className="ux4g-body-s-default">
              Patient: <strong>{patientName}</strong>
            </p>
          )}

          <Field id="indication" label={WORDING.indication} />

          {admissionId === undefined ? (
            <>
              <Field id="patientName" label={WORDING.patientName} />
              <Field
                id="ipNo"
                label={WORDING.ipNumber}
                hint="The admission’s identity on the ward."
              />
              <Field id="ward" label={WORDING.ward} />

              <div className="ux4g-form-group app-stack-tight">
                <label className="ux4g-label-m-strong" htmlFor="patientBloodGroup">
                  Patient’s own blood group
                </label>
                <select
                  className="ux4g-form-select ux4g-form-select-md"
                  id="patientBloodGroup"
                  name="patientBloodGroup"
                  defaultValue=""
                >
                  <option value="">Not known</option>
                  {groupOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="ux4g-label-m-default">
                  {/*
                    Not the same claim as the group being requested: an
                    emergency is often answered with O− whatever the patient
                    turns out to be.
                  */}
                  Needed only if you are naming the patient here.
                </p>
              </div>

              <div className="app-row">
                <Field id="age" label={WORDING.age} type="number" inputMode="numeric" />
                <div className="ux4g-form-group app-stack-tight">
                  <label className="ux4g-label-m-strong" htmlFor="ageUnit">
                    Age unit
                  </label>
                  <select
                    className="ux4g-form-select ux4g-form-select-md"
                    id="ageUnit"
                    name="ageUnit"
                    defaultValue="years"
                  >
                    <option value="years">Years</option>
                    <option value="months">Months</option>
                    <option value="days">Days</option>
                  </select>
                </div>
              </div>

              <div className="ux4g-form-group app-stack-tight">
                <label className="ux4g-label-m-strong" htmlFor="sex">
                  {WORDING.sex}
                </label>
                <select
                  className="ux4g-form-select ux4g-form-select-md"
                  id="sex"
                  name="sex"
                  defaultValue=""
                >
                  <option value="">Not stated</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <Field id="uhid" label={WORDING.hospitalId} />
              <Field id="attenderName" label={WORDING.attenderName} />
              <Field
                id="attenderPhone"
                label={WORDING.attenderPhone}
                type="tel"
                inputMode="tel"
              />
              <Field id="diagnosis" label={WORDING.knownDiagnosis} />
              <Field id="history" label={WORDING.relevantHistory} />
            </>
          ) : null}
        </div>
      </details>
    </form>
  );
}
