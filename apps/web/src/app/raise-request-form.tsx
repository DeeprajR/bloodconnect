'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button } from '@blood-connect/ui';

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
 * **Four inputs, and speed is the requirement.** This is filled at a bedside
 * by somebody handling several patients, often standing up, sometimes with a
 * bleeding patient in front of them. So the four are big, tappable and above
 * the fold, and everything else is behind one disclosure that starts closed.
 *
 * Three consequences of that priority, each deliberate:
 *
 *  1. **Buttons, not dropdowns**, for group, product and urgency. A native
 *     select is two taps and a scroll; a radio grid is one tap and needs no
 *     aim. It costs vertical space, which is the right thing to spend here.
 *  2. **The collapsed section is a native `<details>`.** No JavaScript
 *     decides whether it opens, so it works before hydration and on a bad
 *     hospital connection, and the fields inside are still in the form, so
 *     a doctor who opened it, filled it, and collapsed it again does not
 *     lose the answers.
 *  3. **Nothing inside it is required.** Opening it must never be able to
 *     stop the request going through; the centre fills in what is missing
 *     when the bystander arrives with the ID.
 */

const initial: FormState = { error: null };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      loading={pending}
      className="h-12 w-full text-base"
    >
      {pending ? 'Sending…' : 'Send to the blood centre'}
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

/**
 * A row of tappable options, as radios.
 *
 * Radios rather than buttons with state: the browser handles selection,
 * keyboard and screen-reader semantics, and the form submits without a
 * single line of JavaScript. The visible control is the label; the input
 * itself is visually hidden but not hidden from assistive technology.
 *
 * The `has-[input:checked]` variant reads the checked state from the input
 * inside the label and styles the label itself; no useState involved.
 */
function ChoiceRow({
  name,
  legend,
  options,
  defaultValue,
  columns = 3,
}: {
  name: string;
  legend: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string;
  columns?: number;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="block text-sm font-semibold text-ink">{legend}</legend>
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${String(columns)}, minmax(0, 1fr))` }}
      >
        {options.map((option) => (
          <label
            key={option.value}
            className="flex h-12 cursor-pointer items-center justify-center rounded-control border border-border-strong bg-surface px-2 text-center text-sm font-medium text-ink transition-colors hover:bg-surface-muted focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 has-[input:checked]:border-primary has-[input:checked]:bg-primary-soft has-[input:checked]:text-primary"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              defaultChecked={option.value === defaultValue}
              required
              className="sr-only"
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
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        className="h-10 w-full rounded-control border border-border-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        id={id}
        name={id}
        type={type}
        {...(inputMode !== undefined ? { inputMode } : {})}
        {...(defaultValue !== undefined ? { defaultValue } : {})}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-ink-subtle">
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

  /** Whatever came back from a rejected submit, or nothing on a first render. */
  const was = (field: string): string => state.values?.[field] ?? '';

  /**
   * `useActionState` re-renders the same mounted `<form>` rather than
   * remounting it, and a radio's `defaultChecked` is only applied on mount
   * — never on a later re-render, the same rule that governs a `<select>`'s
   * `defaultValue`. Keying each choice row to the values that came back
   * forces a remount when — and only when — a new server response arrives,
   * so `defaultChecked` is reapplied and a rejected submit does not present
   * as four unanswered questions instead of one.
   */
  const valuesKey = JSON.stringify(state.values ?? {});

  const wasUnits = was('units');
  const [moreUnits, setMoreUnits] = useState(
    () => wasUnits !== '' && !unitOptions.some((option) => option.value === wasUnits),
  );

  return (
    <form action={action} className="space-y-5" noValidate>
      <Problem message={state.error} />

      {/* ---------------------------------------------------- the four --- */}

      <ChoiceRow
        key={`bloodGroup-${valuesKey}`}
        name="bloodGroup"
        legend={WORDING.requestedBloodGroup}
        options={groupOptions}
        defaultValue={was('bloodGroup')}
        columns={4}
      />

      <ChoiceRow
        key={`product-${valuesKey}`}
        name="product"
        legend={WORDING.product}
        options={productOptions}
        defaultValue={was('product') === '' ? 'prbc' : was('product')}
      />

      <fieldset className="space-y-2">
        <legend className="block text-sm font-semibold text-ink">
          {WORDING.units}
        </legend>
        {moreUnits ? (
          <input
            key={`units-${valuesKey}`}
            className="h-12 w-full rounded-control border border-border-strong bg-surface px-3 text-lg font-medium text-ink tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            name="units"
            type="number"
            inputMode="numeric"
            min="1"
            defaultValue={wasUnits === '' ? '5' : wasUnits}
            autoFocus
            required
            aria-label={WORDING.units}
          />
        ) : (
          <div
            key={`units-${valuesKey}`}
            className="grid gap-2"
            style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}
          >
            {unitOptions.map((option) => (
              <label
                key={option.value}
                className="flex h-12 cursor-pointer items-center justify-center rounded-control border border-border-strong bg-surface text-sm font-medium text-ink transition-colors hover:bg-surface-muted focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 has-[input:checked]:border-primary has-[input:checked]:bg-primary-soft has-[input:checked]:text-primary"
              >
                <input
                  type="radio"
                  name="units"
                  value={option.value}
                  defaultChecked={option.value === wasUnits}
                  required
                  className="sr-only"
                />
                <span>{option.label}</span>
              </label>
            ))}
            {/*
              Four buttons cover almost every request; the fifth swaps in a
              number field rather than putting twenty buttons on the screen.
            */}
            <button
              type="button"
              onClick={() => {
                setMoreUnits(true);
              }}
              className="flex h-12 items-center justify-center rounded-control border border-dashed border-border-strong bg-surface text-sm font-medium text-ink-muted transition-colors hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              5+
            </button>
          </div>
        )}
      </fieldset>

      <ChoiceRow
        key={`urgency-${valuesKey}`}
        name="urgency"
        legend="How urgent?"
        options={urgencyOptions}
        defaultValue={was('urgency')}
      />

      <Submit />

      {/* ------------------------------------------------ the rest ------- */}
      {/*
        Closed by default, and open when the doctor arrived from an admitted
        patient, the one case where they already have the answers in front
        of them and retyping would be the slow path.
      */}
      <details
        className="group rounded-card border border-border bg-surface"
        open={admissionId !== undefined}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-ink">
              Patient and clinical details
            </p>
            <p className="text-xs text-ink-subtle">
              Optional, the blood centre fills these in
            </p>
          </div>
          {/*
            `display: flex` on a `<summary>` removes the browser's own
            marker, so the chevron is drawn here where it can be placed
            and rotated on open. Hidden from assistive technology: the
            open/closed state is already on the `<details>` element.
          */}
          <svg
            className="size-5 shrink-0 text-ink-subtle transition-transform group-open:rotate-180"
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

        <div className="space-y-4 border-t border-border px-4 py-4">
          <p className="text-xs text-ink-subtle">
            {/*
              Said plainly, because a doctor who does not know this will
              fill in twenty fields they did not need to (ADR 0010).
            */}
            Leave all of this to the blood centre. They collect it from the
            patient&rsquo;s bystander at the counter, using the ID you are
            about to get. Fill it in only if you already have it to hand.
          </p>

          {admissionId === undefined ? null : (
            <input type="hidden" name="admissionId" value={admissionId} />
          )}

          {patientName === undefined ? null : (
            <p className="text-sm text-ink">
              Patient: <strong className="font-semibold">{patientName}</strong>
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

              <div className="space-y-1.5">
                <label
                  htmlFor="patientBloodGroup"
                  className="block text-sm font-medium text-ink"
                >
                  Patient’s own blood group
                </label>
                <select
                  className="h-10 w-full rounded-control border border-border-strong bg-surface px-3 pr-8 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
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
                <p className="text-xs text-ink-subtle">
                  {/*
                    Not the same claim as the group being requested: an
                    emergency is often answered with O− whatever the patient
                    turns out to be.
                  */}
                  Needed only if you are naming the patient here.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  id="age"
                  label={WORDING.age}
                  type="number"
                  inputMode="numeric"
                />
                <div className="space-y-1.5">
                  <label
                    htmlFor="ageUnit"
                    className="block text-sm font-medium text-ink"
                  >
                    Age unit
                  </label>
                  <select
                    className="h-10 w-full rounded-control border border-border-strong bg-surface px-3 pr-8 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
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

              <div className="space-y-1.5">
                <label
                  htmlFor="sex"
                  className="block text-sm font-medium text-ink"
                >
                  {WORDING.sex}
                </label>
                <select
                  className="h-10 w-full rounded-control border border-border-strong bg-surface px-3 pr-8 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
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
