'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  Button,
  FormField,
  Select,
  TextArea,
  TextInput,
} from '@blood-connect/ui';

import { BLOOD_GROUPS, WORDING, bloodGroupLabel } from '@blood-connect/domain';

import { attachPatientAction, type FormState } from './centre-actions';

/**
 * The patient, taken from the bystander at the desk (ADR 0010).
 *
 * The other half of the request slip: a doctor gave four fields and read
 * an ID aloud; somebody carried it here, and this is where the patient
 * finally gets a name. Until it is filled the request cannot be reserved
 * against or issued. Except for an emergency, which may be answered first
 * and completed after.
 *
 * **Four fields are demanded and the rest are offered**, in the order
 * somebody actually asks them: who is this, where are they, how old, what
 * group. The four are what the record cannot exist without. Everything
 * else is worth asking while the person is standing there, which is why
 * it is on the page at all, but behind a disclosure, because it must
 * never be what delays a unit.
 *
 * Kit-native (ADR 0015): the disclosure is a native `<details>` styled
 * with Tailwind's `group-open` variant, so nothing on the page depends on
 * JavaScript being loaded — the same reason the ux4g version used a
 * `<details>`, kept exactly.
 */

const initial: FormState = { error: null };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} className="w-full sm:w-auto">
      {pending ? 'Recording…' : 'Record the patient'}
    </Button>
  );
}

function Problem({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
    >
      {message}
    </div>
  );
}

export function AttachPatientForm({ requestUuid }: { requestUuid: string }) {
  const [state, action] = useActionState(
    attachPatientAction.bind(null, requestUuid),
    initial,
  );

  if (state.done === true) {
    return (
      <div
        role="status"
        className="rounded-control border border-success/30 bg-success-soft px-3 py-2 text-sm text-ink"
      >
        <span className="font-medium text-success">Patient recorded.</span>{' '}
        This request can be answered now.
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      <Problem message={state.error} />

      <FormField label={WORDING.patientName} required>
        {(p) => (
          <TextInput
            {...p}
            name="name"
            required
            autoFocus
            className="text-base"
          />
        )}
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label={WORDING.ipNumber}
          hint="From the ward. It identifies the admission."
          required
        >
          {(p) => <TextInput {...p} name="ipNo" required />}
        </FormField>
        <FormField label={WORDING.ward}>
          {(p) => <TextInput {...p} name="ward" />}
        </FormField>
      </div>

      <FormField
        label={`Patient's own ${WORDING.bloodGroupAndRh}`}
        // Not the group on the request. An emergency is often answered
        // with O− whatever the patient turns out to be, and recording one
        // as the other would put a group nobody measured onto a clinical
        // record.
        hint="What the patient is, not what was asked for. The centre types every unit before it is used."
        required
      >
        {(p) => (
          <Select
            {...p}
            name="bloodGroup"
            defaultValue=""
            required
            className="text-base"
          >
            <option value="">Choose</option>
            {BLOOD_GROUPS.map((g) => (
              <option key={g} value={g}>
                {bloodGroupLabel(g)}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={WORDING.age}>
          {(p) => (
            <TextInput
              {...p}
              name="age"
              type="number"
              inputMode="numeric"
            />
          )}
        </FormField>
        <FormField
          label="Age unit"
          // A neonate is recorded in days, which is why the unit exists.
          hint="A newborn is usually recorded in days."
        >
          {(p) => (
            <Select {...p} name="ageUnit" defaultValue="years">
              <option value="years">Years</option>
              <option value="months">Months</option>
              <option value="days">Days</option>
            </Select>
          )}
        </FormField>
      </div>

      <FormField
        label={WORDING.dateOfBirth}
        hint="Give this or the age above. The record needs one of them."
      >
        {(p) => <TextInput {...p} name="dob" type="date" />}
      </FormField>

      <FormField label={WORDING.sex}>
        {(p) => (
          <Select {...p} name="sex" defaultValue="">
            <option value="">Not stated</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
          </Select>
        )}
      </FormField>

      {/*
        Worth asking while the person is at the desk, but never what
        delays a unit, so it is offered, not demanded. `group` +
        `group-open:` lets the chevron rotate on open without one line
        of JavaScript.
      */}
      <details className="group rounded-card border border-border bg-surface-muted">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <span className="flex flex-col">
            <span className="text-sm font-medium text-ink">
              Contact and clinical context
            </span>
            <span className="text-xs text-ink-muted">
              Optional, ask while they are here
            </span>
          </span>
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
            focusable="false"
            className="shrink-0 text-ink-muted transition-transform group-open:rotate-180"
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

        <div className="space-y-4 border-t border-border bg-surface px-4 py-4">
          <FormField label={WORDING.hospitalId}>
            {(p) => <TextInput {...p} name="uhid" />}
          </FormField>
          <FormField label={WORDING.attenderName}>
            {(p) => <TextInput {...p} name="attenderName" />}
          </FormField>
          <FormField label={WORDING.attenderPhone}>
            {(p) => (
              <TextInput
                {...p}
                name="attenderPhone"
                type="tel"
                inputMode="tel"
              />
            )}
          </FormField>
          <FormField label="Address">
            {(p) => <TextArea {...p} name="address" rows={2} />}
          </FormField>
          <FormField label={WORDING.knownDiagnosis}>
            {(p) => <TextArea {...p} name="diagnosis" rows={2} />}
          </FormField>
          <FormField label={WORDING.relevantHistory}>
            {(p) => <TextArea {...p} name="history" rows={2} />}
          </FormField>

          <FormField label={WORDING.previousTransfusion}>
            {(p) => (
              <Select
                {...p}
                name="previousTransfusion"
                defaultValue="unknown"
              >
                <option value="unknown">Unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Select>
            )}
          </FormField>

          <FormField label={WORDING.previousReaction}>
            {(p) => <TextArea {...p} name="previousReaction" rows={2} />}
          </FormField>
        </div>
      </details>

      <Submit />
    </form>
  );
}
