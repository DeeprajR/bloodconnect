'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  Button,
  FormField,
  Select,
  TextArea,
  TextInput,
} from '@blood-connect/ui';

import {
  BLOOD_GROUPS,
  WORDING,
  bloodGroupLabel,
} from '@blood-connect/domain';
import {
  allowedOutcomes,
  defaultOutcome,
  type StorageBand,
} from '@blood-connect/centre/rules/returns';

import {
  discardBagAction,
  lookUpTagAction,
  markRosterAction,
  raiseDiscrepancyAction,
  recordWalkInAction,
  releaseTagAction,
  resolveDiscrepancyAction,
  resolveQuarantineAction,
  returnBagAction,
  type FormState,
} from './centre-actions';

const initial: FormState = { error: null };

function Submit({
  label,
  busy,
  variant = 'primary',
}: {
  label: string;
  busy: string;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} loading={pending}>
      {pending ? busy : label}
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

function Done({ shown, text }: { shown: boolean; text: string }) {
  if (!shown) return null;
  return (
    <p
      role="status"
      className="rounded-control border border-success/30 bg-success-soft px-3 py-2 text-sm text-ink"
    >
      {text}
    </p>
  );
}

/**
 * A checkbox with its own label and, optionally, a hint below it. Kit has no
 * dedicated checkbox component, so this is a small local one matching the
 * kit's own control styling (`accent-primary`, the same focus ring as
 * `TextInput`/`Select`).
 */
function Checkbox({
  id,
  name,
  label,
  hint,
}: {
  id: string;
  name: string;
  label: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          id={id}
          name={name}
          className="mt-0.5 size-4 rounded border-border-strong accent-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        />
        <span>{label}</span>
      </label>
      {hint ? <p className="pl-6 text-xs text-ink-subtle">{hint}</p> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The scan                                                                    */
/* -------------------------------------------------------------------------- */

export function TagLookupForm({ defaultValue }: { defaultValue: string }) {
  const [state, action] = useActionState(lookUpTagAction, initial);

  return (
    <form action={action} className="space-y-4">
      <Problem message={state.error} />
      <FormField
        label="Tag identifier"
        // §10: the typed path is required whatever the hardware.
        hint="A reader types into this field. So can you."
      >
        {(p) => (
          <TextInput
            {...p}
            name="tagUid"
            defaultValue={defaultValue}
            autoFocus
            required
            className="text-base"
          />
        )}
      </FormField>
      <Submit label="Look it up" busy="Looking…" />
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Case 1. The return                                                         */
/* -------------------------------------------------------------------------- */

const BAND_LABELS: Readonly<Record<StorageBand, string>> = {
  under_30m: 'Under 30 minutes, in a transport fridge',
  '30m_to_limit': 'Longer than 30 minutes, within our limit',
  over_limit: 'Longer than our limit',
  unknown: 'Nobody can say',
};

/**
 * Recording a return (§4).
 *
 * The band is asked **first**, and the outcomes below it change with the answer
 *, because "that, not convenience, decides what happens next". An interface
 * that offered Restock and then refused it would teach somebody to guess a
 * shorter time next time.
 */
export function ReturnBagForm({
  bagId,
  limitMinutes,
}: {
  bagId: string;
  limitMinutes: number;
}) {
  const [state, action] = useActionState(returnBagAction.bind(null, bagId), initial);
  const [band, setBand] = useState<StorageBand>('unknown');
  const [outcome, setOutcome] = useState<string>('quarantine');

  const allowed = allowedOutcomes(band);

  return (
    <form action={action} className="space-y-4" noValidate>
      <Problem message={state.error} />
      <Done shown={state.done === true} text="Return recorded." />

      <FormField
        label="How long was it out of controlled storage?"
        hint={`Our limit is ${limitMinutes} minutes, from the centre’s own SOP.`}
      >
        {(p) => (
          <Select
            {...p}
            name="outOfStorageBand"
            defaultValue="unknown"
            onChange={(e) => {
              const next = e.target.value as StorageBand;
              setBand(next);
              setOutcome(defaultOutcome(next));
            }}
          >
            {(Object.keys(BAND_LABELS) as StorageBand[]).map((key) => (
              <option key={key} value={key}>
                {BAND_LABELS[key]}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <Checkbox
        id="coldChainDocumented"
        name="coldChainDocumented"
        label="The cold chain is documented"
      />

      <FormField
        label="What happens to it?"
        {...(!allowed.includes('restock')
          ? {
              hint:
                band === 'unknown'
                  ? // §4 defaults to quarantine when the time is unknown, and the
                    // database refuses a restock that is not within the limit.
                    'Because nobody can say how long it was out, this unit cannot go back on the shelf.'
                  : 'It was out too long to go back on the shelf.',
            }
          : {})}
      >
        {(p) => (
          <Select
            {...p}
            name="outcome"
            value={outcome}
            onChange={(e) => {
              setOutcome(e.target.value);
            }}
          >
            {allowed.includes('restock') ? (
              <option value="restock">Back on the shelf</option>
            ) : null}
            <option value="quarantine">{WORDING.quarantine}, pending a decision</option>
            <option value="discard">Discard</option>
          </Select>
        )}
      </FormField>

      {outcome === 'discard' ? (
        <FormField
          label="Disposal route"
          // §12.1: a status change is not the end of the bag.
          hint="Where the unit physically went."
          required
        >
          {(p) => <TextInput {...p} name="disposalRoute" required />}
        </FormField>
      ) : null}

      <FormField label="Note">
        {(p) => <TextArea {...p} name="note" rows={2} />}
      </FormField>

      <Submit label="Record the return" busy="Recording…" />
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Case 2: release                                                            */
/* -------------------------------------------------------------------------- */

export function ReleaseTagForm({ tagUid }: { tagUid: string }) {
  const [state, action] = useActionState(releaseTagAction.bind(null, tagUid), initial);

  if (state.done === true) {
    return (
      <p
        role="status"
        className="rounded-control border border-success/30 bg-success-soft px-3 py-2 text-sm text-ink"
      >
        Released. Register the new bag through the intake form. It gets its own
        collection date and its own expiry.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      <Problem message={state.error} />

      <FormField
        label="Why is the tag being released?"
        hint="Recorded against you, on the assignment history."
        required
      >
        {(p) => <TextInput {...p} name="reason" required />}
      </FormField>

      <Checkbox
        id="retire"
        name="retire"
        label="Retire this tag. It reads unreliably"
        // §4: a retired tag can never be assigned again.
        hint="A retired tag can never carry a bag again."
      />

      <Submit label="Release the tag" busy="Releasing…" variant="secondary" />
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Case 3: raise, and the three endings                                       */
/* -------------------------------------------------------------------------- */

export function RaiseDiscrepancyForm({ tagUid }: { tagUid: string }) {
  const [state, action] = useActionState(raiseDiscrepancyAction.bind(null, tagUid), initial);

  if (state.done === true) {
    return (
      <p
        role="status"
        className="rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-ink"
      >
        Raised. It stays open until somebody has physically looked.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      <Problem message={state.error} />
      <FormField label="What did you see?">
        {(p) => <TextArea {...p} name="note" rows={2} />}
      </FormField>
      <Submit label="Raise a discrepancy" busy="Raising…" variant="danger" />
    </form>
  );
}

const FINDINGS = [
  {
    value: 'duplicate_tag',
    label: 'The conflicting bag is on the shelf',
    outcome: 'This tag is a duplicate or a clone. It will be retired for good.',
  },
  {
    value: 'bag_missing',
    label: 'The conflicting bag is not there',
    outcome:
      'It left without being scanned out. It will be marked lost, a reportable event, and the tag freed.',
  },
  {
    value: 'mis_scan',
    label: 'It was a mis-scan',
    outcome: 'Nothing changes. The bag is on the shelf and so is its tag.',
  },
] as const;

/**
 * Closing a discrepancy, exactly three ways (§4).
 *
 * The consequence of each is shown **before** it is chosen, because these are
 * not equivalent: one retires a tag permanently, one marks a unit of blood lost
 * and reportable, and one does nothing at all.
 *
 * The radio list uses the same `has-[input:checked]` styling as the
 * doctor-side `ChoiceRow` (`raise-request-form.tsx`) — a native radio group,
 * so selection, keyboard and screen-reader behaviour all come from the
 * browser rather than from JavaScript.
 */
export function DiscrepancyForm({
  discrepancyId,
  unitNumber,
}: {
  discrepancyId: string;
  unitNumber: string;
}) {
  const [state, action] = useActionState(
    resolveDiscrepancyAction.bind(null, discrepancyId),
    initial,
  );
  const [finding, setFinding] = useState<string>('mis_scan');

  if (state.done === true) {
    return <p className="text-sm text-ink-muted">Closed.</p>;
  }

  const chosen = FINDINGS.find((f) => f.value === finding);

  return (
    <form action={action} className="space-y-4" noValidate>
      <Problem message={state.error} />

      <fieldset className="space-y-2">
        <legend className="block text-sm font-semibold text-ink">
          What did you find when you looked for {unitNumber}?
        </legend>
        <div className="space-y-2">
          {FINDINGS.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-start gap-3 rounded-control border border-border-strong bg-surface px-3 py-2.5 text-sm text-ink transition-colors hover:bg-surface-muted has-[input:checked]:border-primary has-[input:checked]:bg-primary-soft"
            >
              <input
                type="radio"
                name="finding"
                value={option.value}
                checked={finding === option.value}
                onChange={() => {
                  setFinding(option.value);
                }}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {chosen ? (
        <p
          role="status"
          className="rounded-control border border-info/30 bg-info-soft px-3 py-2 text-sm text-ink"
        >
          {chosen.outcome}
        </p>
      ) : null}

      <FormField
        label="What you found"
        // §4: each ending requires the resolver's identity and a note.
        hint="Recorded with your name. It is the record of the investigation."
        required
      >
        {(p) => <TextArea {...p} name="note" rows={2} required />}
      </FormField>

      <Submit label="Close the discrepancy" busy="Closing…" />
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Quarantine and discard                                                      */
/* -------------------------------------------------------------------------- */

export function QuarantineForm({ quarantineId }: { quarantineId: string }) {
  const [state, action] = useActionState(
    resolveQuarantineAction.bind(null, quarantineId),
    initial,
  );
  const [resolution, setResolution] = useState('available');

  if (state.done === true) return <p className="text-sm text-ink-muted">Resolved.</p>;

  return (
    <form action={action} className="space-y-4" noValidate>
      <Problem message={state.error} />

      <FormField label="Decision">
        {(p) => (
          <Select
            {...p}
            name="resolution"
            value={resolution}
            onChange={(e) => {
              setResolution(e.target.value);
            }}
          >
            <option value="available">Back on the shelf</option>
            <option value="discarded">Discard</option>
          </Select>
        )}
      </FormField>

      {resolution === 'discarded' ? (
        <FormField label="Disposal route" required>
          {(p) => <TextInput {...p} name="disposalRoute" required />}
        </FormField>
      ) : (
        <input type="hidden" name="disposalRoute" value="" />
      )}

      <FormField label="What was decided, and why" required>
        {(p) => <TextArea {...p} name="note" rows={2} required />}
      </FormField>

      <Submit label="Resolve" busy="Resolving…" />
    </form>
  );
}

export function DiscardBagForm({ bagId }: { bagId: string }) {
  const [state, action] = useActionState(discardBagAction.bind(null, bagId), initial);
  const [open, setOpen] = useState(false);

  if (state.done === true) return <span className="text-sm text-ink-muted">Discarded</span>;

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        Discard
      </Button>
    );
  }

  return (
    <form action={action} className="space-y-2" noValidate>
      <Problem message={state.error} />
      <TextInput name="reason" placeholder="Reason" required aria-label="Reason" />
      <TextInput
        name="disposalRoute"
        placeholder="Disposal route"
        required
        aria-label="Disposal route"
      />
      <Submit label="Discard the unit" busy="Discarding…" variant="danger" />
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* The roster                                                                  */
/* -------------------------------------------------------------------------- */

const groupOptions = BLOOD_GROUPS.map((g) => ({ value: g, label: bloodGroupLabel(g) }));

/**
 * Marking one donor at the counter (§4).
 *
 * The typed group is a **separate question** from the group on the roster row.
 * A donor who guessed wrong is exactly the case verification exists for, and
 * this answer is what lets the bot mark their group verified at all.
 */
export function RosterMarkForm({
  confirmationId,
  declaredGroup,
}: {
  confirmationId: string;
  declaredGroup: string;
}) {
  const [state, action] = useActionState(markRosterAction.bind(null, confirmationId), initial);
  const [outcome, setOutcome] = useState('completed');

  if (state.done === true) return <span className="text-sm text-ink-muted">Recorded</span>;

  return (
    <form action={action} className="space-y-2" noValidate>
      <Problem message={state.error} />

      <Select
        name="outcome"
        value={outcome}
        onChange={(e) => {
          setOutcome(e.target.value);
        }}
        aria-label="Outcome"
      >
        <option value="completed">Donated</option>
        <option value="no_show">No-show</option>
        <option value="cancelled">Cancelled</option>
      </Select>

      {outcome === 'completed' ? (
        <>
          <TextInput
            name="bagIdentifier"
            placeholder={WORDING.unitNumber}
            required
            aria-label={WORDING.unitNumber}
          />
          <Select
            name="donatedBloodGroup"
            defaultValue={declaredGroup}
            aria-label="Group the unit typed as"
          >
            {groupOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <p className="text-xs text-ink-subtle">
            The group the unit <strong className="font-medium text-ink">typed as</strong>, which
            may not be the one they told us. This is what confirms their group for future
            requests.
          </p>
        </>
      ) : null}

      <Submit label="Record" busy="Recording…" variant="secondary" />
    </form>
  );
}

/**
 * Somebody who gave blood without ever confirming in the bot (§4).
 *
 * "The centre is the authority on who gave blood; getting a donor's interval
 * right matters more than tidy state."
 */
export function WalkInForm({ demandId }: { demandId: string }) {
  const [state, action] = useActionState(recordWalkInAction.bind(null, demandId), initial);
  const [open, setOpen] = useState(false);

  if (state.done === true) {
    return <p className="text-sm text-ink-muted">Walk-in recorded.</p>;
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        Record a walk-in
      </Button>
    );
  }

  return (
    <form action={action} className="space-y-2" noValidate>
      <Problem message={state.error} />
      <TextInput name="donorName" placeholder="Donor name" required aria-label="Donor name" />
      <TextInput
        name="donorPhone"
        placeholder="Phone number"
        required
        aria-label="Phone number"
      />
      <Select name="bloodGroup" required aria-label="Group the unit typed as">
        {groupOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      <TextInput
        name="bagIdentifier"
        placeholder={WORDING.unitNumber}
        required
        aria-label={WORDING.unitNumber}
      />
      <Submit label="Record the donation" busy="Recording…" />
    </form>
  );
}
