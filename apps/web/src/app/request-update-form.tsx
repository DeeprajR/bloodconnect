'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  Button,
  FormField,
  TextArea,
  TextInput,
} from '@blood-connect/ui';

import type { FormState } from './actions';

const initial: FormState = { error: null };

const FIELDS = [
  { value: 'full_name', label: 'Full name' },
  { value: 'provisional_reg', label: 'Registration number' },
] as const;

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

/**
 * Asking for the two fields a doctor cannot change themselves (§3).
 *
 * The current value is prefilled into the box, because almost every
 * request here is a correction, a missing initial, a transposed digit,
 * and retyping a long registration number from memory is how a second
 * mistake gets in.
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
      <p
        role="status"
        className="rounded-control border border-success/30 bg-success-soft px-3 py-2 text-sm text-ink"
      >
        Sent to your administrator. You will see it here until it is decided.
      </p>
    );
  }

  const current = field === 'full_name' ? currentName : currentReg;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <KitProblem message={state.error} />

      <fieldset className="space-y-2">
        <legend className="block text-sm font-semibold text-ink">
          What needs changing
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {FIELDS.map((option) => (
            <label
              key={option.value}
              className="flex h-11 cursor-pointer items-center justify-center rounded-control border border-border-strong bg-surface px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-muted focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 has-[input:checked]:border-primary has-[input:checked]:bg-primary-soft has-[input:checked]:text-primary"
              htmlFor={`field-${option.value}`}
            >
              <input
                type="radio"
                id={`field-${option.value}`}
                name="field"
                value={option.value}
                checked={field === option.value}
                onChange={() => {
                  setField(option.value);
                }}
                className="sr-only"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <FormField
        label="What it should say"
        hint={
          current
            ? `Currently ${current}.`
            : 'Nothing is recorded at the moment.'
        }
        required
      >
        {(props) => (
          <TextInput
            {...props}
            name="proposedValue"
            // Keyed on the field so switching between the two reloads the
            // box with the right current value instead of keeping the
            // other one.
            key={field}
            defaultValue={current}
            maxLength={200}
            required
          />
        )}
      </FormField>

      <FormField
        label="Why"
        hint="An administrator decides on this, so give them something to decide on."
        required
      >
        {(props) => (
          <TextArea
            {...props}
            name="reason"
            rows={3}
            maxLength={500}
            required
          />
        )}
      </FormField>

      <KitSubmit label="Send the request" busy="Sending…" />
    </form>
  );
}
