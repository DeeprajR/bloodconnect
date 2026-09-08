'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  BLOOD_GROUPS,
  WORDING,
  bloodGroupLabel,
} from '@blood-connect/domain';
import { allowedOutcomes, defaultOutcome, type StorageBand } from '@blood-connect/centre';

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
  tone = 'primary',
}: {
  label: string;
  busy: string;
  tone?: 'primary' | 'outline-danger' | 'outline-primary';
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={`ux4g-btn ux4g-btn-${tone} ux4g-btn-lg app-target`}
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

function Done({ shown, text }: { shown: boolean; text: string }) {
  if (!shown) return null;
  return (
    <div className="ux4g-alert ux4g-alert-success" role="status">
      <div className="ux4g-alert-content">
        <p className="ux4g-alert-message">{text}</p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The scan                                                                    */
/* -------------------------------------------------------------------------- */

export function TagLookupForm({ defaultValue }: { defaultValue: string }) {
  const [state, action] = useActionState(lookUpTagAction, initial);

  return (
    <form action={action} className="app-stack">
      <Problem message={state.error} />
      <div className="ux4g-form-group app-stack-tight">
        <label className="ux4g-label-l-strong" htmlFor="tagUid">
          Tag identifier
        </label>
        <input
          className="ux4g-input ux4g-input-lg"
          id="tagUid"
          name="tagUid"
          defaultValue={defaultValue}
          autoFocus
          required
          aria-describedby="tagUid-hint"
        />
        <p className="ux4g-label-m-default" id="tagUid-hint">
          {/* §10: the typed path is required whatever the hardware. */}
          A reader types into this field. So can you.
        </p>
      </div>
      <Submit label="Look it up" busy="Looking…" />
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Case 1 — the return                                                         */
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
 * — because "that, not convenience, decides what happens next". An interface
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
    <form action={action} className="app-stack" noValidate>
      <Problem message={state.error} />
      <Done shown={state.done === true} text="Return recorded." />

      <div className="ux4g-form-group app-stack-tight">
        <label className="ux4g-label-l-strong" htmlFor="outOfStorageBand">
          How long was it out of controlled storage?
        </label>
        <select
          className="ux4g-form-select ux4g-form-select-lg"
          id="outOfStorageBand"
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
        </select>
        <p className="ux4g-label-m-default">
          Our limit is {limitMinutes} minutes, from the centre&rsquo;s own SOP.
        </p>
      </div>

      <div className="ux4g-form-group">
        <label className="ux4g-label-l-strong" htmlFor="coldChainDocumented">
          <input
            type="checkbox"
            id="coldChainDocumented"
            name="coldChainDocumented"
            className="ux4g-checkbox"
          />{' '}
          The cold chain is documented
        </label>
      </div>

      <div className="ux4g-form-group app-stack-tight">
        <label className="ux4g-label-l-strong" htmlFor="outcome">
          What happens to it?
        </label>
        <select
          className="ux4g-form-select ux4g-form-select-lg"
          id="outcome"
          name="outcome"
          value={outcome}
          onChange={(e) => {
            setOutcome(e.target.value);
          }}
        >
          {allowed.includes('restock') ? <option value="restock">Back on the shelf</option> : null}
          <option value="quarantine">{WORDING.quarantine}, pending a decision</option>
          <option value="discard">Discard</option>
        </select>
        {!allowed.includes('restock') ? (
          <p className="ux4g-label-m-default">
            {/*
              §4 defaults to quarantine when the time is unknown, and the
              database refuses a restock that is not within the limit.
            */}
            {band === 'unknown'
              ? 'Because nobody can say how long it was out, this unit cannot go back on the shelf.'
              : 'It was out too long to go back on the shelf.'}
          </p>
        ) : null}
      </div>

      {outcome === 'discard' ? (
        <div className="ux4g-form-group app-stack-tight">
          <label className="ux4g-label-l-strong" htmlFor="disposalRoute">
            Disposal route
          </label>
          <input
            className="ux4g-input ux4g-input-lg"
            id="disposalRoute"
            name="disposalRoute"
            required
          />
          <p className="ux4g-label-m-default">
            {/* §12.1: a status change is not the end of the bag. */}
            Where the unit physically went.
          </p>
        </div>
      ) : null}

      <div className="ux4g-form-group app-stack-tight">
        <label className="ux4g-label-l-strong" htmlFor="note">
          Note <span className="ux4g-label-m-default">(optional)</span>
        </label>
        <textarea className="ux4g-input ux4g-input-lg" id="note" name="note" rows={2} />
      </div>

      <Submit label="Record the return" busy="Recording…" />
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Case 2 — release                                                            */
/* -------------------------------------------------------------------------- */

export function ReleaseTagForm({ tagUid }: { tagUid: string }) {
  const [state, action] = useActionState(releaseTagAction.bind(null, tagUid), initial);

  if (state.done === true) {
    return (
      <div className="ux4g-alert ux4g-alert-success" role="status">
        <div className="ux4g-alert-content">
          <p className="ux4g-alert-message">
            Released. Register the new bag through the intake form — it gets its own
            collection date and its own expiry.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="app-stack" noValidate>
      <Problem message={state.error} />

      <div className="ux4g-form-group app-stack-tight">
        <label className="ux4g-label-l-strong" htmlFor="reason">
          Why is the tag being released?
        </label>
        <input className="ux4g-input ux4g-input-lg" id="reason" name="reason" required />
        <p className="ux4g-label-m-default">Recorded against you, on the assignment history.</p>
      </div>

      <div className="ux4g-form-group">
        <label className="ux4g-label-l-strong" htmlFor="retire">
          <input type="checkbox" id="retire" name="retire" className="ux4g-checkbox" /> Retire
          this tag — it reads unreliably
        </label>
        <p className="ux4g-label-m-default">
          {/* §4: a retired tag can never be assigned again. */}
          A retired tag can never carry a bag again.
        </p>
      </div>

      <Submit label="Release the tag" busy="Releasing…" tone="outline-primary" />
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Case 3 — raise, and the three endings                                       */
/* -------------------------------------------------------------------------- */

export function RaiseDiscrepancyForm({ tagUid }: { tagUid: string }) {
  const [state, action] = useActionState(raiseDiscrepancyAction.bind(null, tagUid), initial);

  if (state.done === true) {
    return (
      <div className="ux4g-alert ux4g-alert-warning" role="status">
        <div className="ux4g-alert-content">
          <p className="ux4g-alert-message">
            Raised. It stays open until somebody has physically looked.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="app-stack" noValidate>
      <Problem message={state.error} />
      <div className="ux4g-form-group app-stack-tight">
        <label className="ux4g-label-l-strong" htmlFor="discrepancyNote">
          What did you see? <span className="ux4g-label-m-default">(optional)</span>
        </label>
        <textarea
          className="ux4g-input ux4g-input-lg"
          id="discrepancyNote"
          name="note"
          rows={2}
        />
      </div>
      <Submit label="Raise a discrepancy" busy="Raising…" tone="outline-danger" />
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
      'It left without being scanned out. It will be marked lost — a reportable event — and the tag freed.',
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
    return <p className="ux4g-body-s-default">Closed.</p>;
  }

  const chosen = FINDINGS.find((f) => f.value === finding);

  return (
    <form action={action} className="app-stack" noValidate>
      <Problem message={state.error} />

      <fieldset className="ux4g-form-group app-stack-tight">
        <legend className="ux4g-label-l-strong">
          What did you find when you looked for {unitNumber}?
        </legend>
        {FINDINGS.map((option) => (
          <label key={option.value} className="ux4g-label-m-default">
            <input
              type="radio"
              name="finding"
              value={option.value}
              checked={finding === option.value}
              onChange={() => {
                setFinding(option.value);
              }}
            />{' '}
            {option.label}
          </label>
        ))}
      </fieldset>

      {chosen ? (
        <div className="ux4g-alert ux4g-alert-info" role="status">
          <div className="ux4g-alert-content">
            <p className="ux4g-alert-message">{chosen.outcome}</p>
          </div>
        </div>
      ) : null}

      <div className="ux4g-form-group app-stack-tight">
        <label className="ux4g-label-l-strong" htmlFor={`note-${discrepancyId}`}>
          What you found
        </label>
        <textarea
          className="ux4g-input ux4g-input-lg"
          id={`note-${discrepancyId}`}
          name="note"
          rows={2}
          required
        />
        <p className="ux4g-label-m-default">
          {/* §4: each ending requires the resolver's identity and a note. */}
          Recorded with your name. It is the record of the investigation.
        </p>
      </div>

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

  if (state.done === true) return <p className="ux4g-body-s-default">Resolved.</p>;

  return (
    <form action={action} className="app-stack" noValidate>
      <Problem message={state.error} />

      <div className="ux4g-form-group app-stack-tight">
        <label className="ux4g-label-l-strong" htmlFor={`resolution-${quarantineId}`}>
          Decision
        </label>
        <select
          className="ux4g-form-select ux4g-form-select-md"
          id={`resolution-${quarantineId}`}
          name="resolution"
          value={resolution}
          onChange={(e) => {
            setResolution(e.target.value);
          }}
        >
          <option value="available">Back on the shelf</option>
          <option value="discarded">Discard</option>
        </select>
      </div>

      {resolution === 'discarded' ? (
        <div className="ux4g-form-group app-stack-tight">
          <label className="ux4g-label-l-strong" htmlFor={`route-${quarantineId}`}>
            Disposal route
          </label>
          <input
            className="ux4g-input ux4g-input-md"
            id={`route-${quarantineId}`}
            name="disposalRoute"
            required
          />
        </div>
      ) : (
        <input type="hidden" name="disposalRoute" value="" />
      )}

      <div className="ux4g-form-group app-stack-tight">
        <label className="ux4g-label-l-strong" htmlFor={`qnote-${quarantineId}`}>
          What was decided, and why
        </label>
        <textarea
          className="ux4g-input ux4g-input-md"
          id={`qnote-${quarantineId}`}
          name="note"
          rows={2}
          required
        />
      </div>

      <Submit label="Resolve" busy="Resolving…" />
    </form>
  );
}

export function DiscardBagForm({ bagId }: { bagId: string }) {
  const [state, action] = useActionState(discardBagAction.bind(null, bagId), initial);
  const [open, setOpen] = useState(false);

  if (state.done === true) return <span className="ux4g-label-m-default">Discarded</span>;

  if (!open) {
    return (
      <button
        type="button"
        className="ux4g-btn ux4g-btn-text-neutral ux4g-btn-md app-target"
        onClick={() => {
          setOpen(true);
        }}
      >
        Discard
      </button>
    );
  }

  return (
    <form action={action} className="app-stack-tight" noValidate>
      <Problem message={state.error} />
      <input
        className="ux4g-input ux4g-input-md"
        name="reason"
        placeholder="Reason"
        required
        aria-label="Reason"
      />
      <input
        className="ux4g-input ux4g-input-md"
        name="disposalRoute"
        placeholder="Disposal route"
        required
        aria-label="Disposal route"
      />
      <Submit label="Discard the unit" busy="Discarding…" tone="outline-danger" />
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

  if (state.done === true) return <span className="ux4g-label-m-default">Recorded</span>;

  return (
    <form action={action} className="app-stack-tight" noValidate>
      <Problem message={state.error} />

      <select
        className="ux4g-form-select ux4g-form-select-md"
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
      </select>

      {outcome === 'completed' ? (
        <>
          <input
            className="ux4g-input ux4g-input-md"
            name="bagIdentifier"
            placeholder={WORDING.unitNumber}
            required
            aria-label={WORDING.unitNumber}
          />
          <select
            className="ux4g-form-select ux4g-form-select-md"
            name="donatedBloodGroup"
            defaultValue={declaredGroup}
            aria-label="Group the unit typed as"
          >
            {groupOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="ux4g-label-m-default">
            The group the unit <strong>typed as</strong>, which may not be the one they
            told us. This is what confirms their group for future requests.
          </p>
        </>
      ) : null}

      <Submit label="Record" busy="Recording…" tone="outline-primary" />
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
    return <p className="ux4g-body-s-default">Walk-in recorded.</p>;
  }

  if (!open) {
    return (
      <button
        type="button"
        className="ux4g-btn ux4g-btn-outline-primary ux4g-btn-md app-target"
        onClick={() => {
          setOpen(true);
        }}
      >
        Record a walk-in
      </button>
    );
  }

  return (
    <form action={action} className="app-stack" noValidate>
      <Problem message={state.error} />
      <input
        className="ux4g-input ux4g-input-md"
        name="donorName"
        placeholder="Donor name"
        required
        aria-label="Donor name"
      />
      <input
        className="ux4g-input ux4g-input-md"
        name="donorPhone"
        placeholder="Phone number"
        required
        aria-label="Phone number"
      />
      <select
        className="ux4g-form-select ux4g-form-select-md"
        name="bloodGroup"
        required
        aria-label="Group the unit typed as"
      >
        {groupOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <input
        className="ux4g-input ux4g-input-md"
        name="bagIdentifier"
        placeholder={WORDING.unitNumber}
        required
        aria-label={WORDING.unitNumber}
      />
      <Submit label="Record the donation" busy="Recording…" />
    </form>
  );
}
