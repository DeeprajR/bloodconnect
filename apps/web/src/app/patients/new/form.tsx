'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, FormField, Select, TextArea, TextInput } from '@blood-connect/ui';

import {
  BLOOD_GROUPS,
  WORDING,
  bloodGroupLabel,
} from '@blood-connect/domain';

import {
  findDuplicatesAction,
  createPatientAction,
  type FormState,
} from '../../hospital-actions';
import type { PossibleDuplicate } from '@blood-connect/hospital';

/**
 * The doctor's patient-recording form (ADR 0010's "record patient" side).
 *
 * Colocated with `/patients/new` in PR-04 of the kit rollout (ADR 0015).
 * Previously lived in `apps/web/src/app/hospital-forms.tsx` alongside three
 * other forms; those still ship UX4G chrome until each of their pages is
 * ported. Splitting this one out lets the kit-styled version stand on its
 * own without changing how `AdmissionForm`, `CancelRequestForm` or
 * `SampleForm` look on the pages that still render them.
 */

const initial: FormState = { error: null };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} className="w-full">
      {pending ? 'Saving…' : 'Save patient and admit'}
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
 * Patients who look like this one (§3).
 *
 * **Shown, never enforced.** Two people genuinely called Anitha Menon arrive
 * at the same hospital, and refusing the second admission at 3am is a far
 * worse failure than recording a duplicate. So this is a panel beside the
 * field with enough to recognise somebody, and the doctor decides.
 */
function DuplicateWarning({ matches }: { matches: readonly PossibleDuplicate[] }) {
  if (matches.length === 0) return null;

  return (
    <div
      role="status"
      className="rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-sm"
    >
      <p className="font-medium text-warning">
        {matches.length === 1
          ? 'A patient with a similar name is already recorded:'
          : `${String(matches.length)} patients with similar names are already recorded:`}
      </p>
      <ul className="mt-1.5 space-y-0.5 text-ink">
        {matches.map((match) => (
          <li key={match.patientId} className="text-xs">
            <strong className="font-semibold">{match.name}</strong>
            {match.uhid ? (
              <span className="tabular-nums"> · {match.uhid}</span>
            ) : null}
            <span className="tabular-nums"> · {match.bloodGroup}</span>
            {match.openAdmission ? (
              <span>
                {' '}
                · on a ward now, {WORDING.ipNumber} {match.openAdmission}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs text-ink-muted">
        If one of these is the same person, use their existing record. If not,
        carry on. This is only a check.
      </p>
    </div>
  );
}

const groupOptions = BLOOD_GROUPS.map((g) => ({
  value: g,
  label: bloodGroupLabel(g),
}));

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
    <form action={action} className="space-y-4" noValidate>
      <Problem message={state.error} />

      <FormField label={WORDING.patientName} required>
        {(props) => (
          <TextInput
            {...props}
            name="name"
            type="text"
            required
            onBlur={checkName}
          />
        )}
      </FormField>
      <DuplicateWarning matches={duplicates} />

      <FormField
        label={WORDING.dateOfBirth}
        hint="Give this, or an age below. A neonate is usually recorded in days."
      >
        {(props) => <TextInput {...props} name="dob" type="date" />}
      </FormField>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={WORDING.age}>
          {(props) => (
            <TextInput
              {...props}
              name="age"
              type="number"
              inputMode="numeric"
              min="0"
            />
          )}
        </FormField>
        <FormField label="Age unit">
          {(props) => (
            <Select {...props} name="ageUnit" defaultValue="years">
              <option value="years">Years</option>
              <option value="months">Months</option>
              <option value="days">Days</option>
            </Select>
          )}
        </FormField>
      </div>

      <FormField label={WORDING.sex} required>
        {(props) => (
          <Select {...props} name="sex" required defaultValue="">
            <option value="" disabled>
              Choose
            </option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
          </Select>
        )}
      </FormField>

      <FormField label={WORDING.bloodGroupAndRh} required>
        {(props) => (
          <Select {...props} name="bloodGroup" required defaultValue="">
            <option value="" disabled>
              Choose
            </option>
            {groupOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField label={WORDING.hospitalId} hint="Unique if given.">
        {(props) => <TextInput {...props} name="uhid" type="text" />}
      </FormField>

      <FormField label={WORDING.attenderName}>
        {(props) => <TextInput {...props} name="attenderName" type="text" />}
      </FormField>

      <FormField label={WORDING.attenderPhone}>
        {(props) => (
          <TextInput
            {...props}
            name="attenderPhone"
            type="tel"
            inputMode="tel"
          />
        )}
      </FormField>

      <FormField label="Address">
        {(props) => <TextArea {...props} name="address" rows={3} />}
      </FormField>

      <FormField label={WORDING.knownDiagnosis}>
        {(props) => <TextArea {...props} name="diagnosis" rows={3} />}
      </FormField>

      <FormField label={WORDING.relevantHistory}>
        {(props) => <TextArea {...props} name="history" rows={3} />}
      </FormField>

      <FormField label={WORDING.previousTransfusion}>
        {(props) => (
          <Select
            {...props}
            name="previousTransfusion"
            defaultValue="unknown"
            onChange={(e) => {
              setPrevious(e.target.value);
            }}
          >
            <option value="unknown">Unknown</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </Select>
        )}
      </FormField>

      {previous === 'yes' ? (
        <FormField label={WORDING.previousReaction} required>
          {(props) => (
            <TextArea {...props} name="previousReaction" rows={3} required />
          )}
        </FormField>
      ) : null}

      <Submit />
    </form>
  );
}
