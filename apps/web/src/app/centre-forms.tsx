'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  BLOOD_GROUPS,
  PRODUCTS,
  WORDING,
  bloodGroupLabel,
  productLabel,
} from '@blood-connect/domain';

import {
  cancelDemandAction,
  decideRequestAction,
  registerBagAction,
  setShelfLifeAction,
  updateSettingsAction,
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

function Saved({ shown }: { shown: boolean }) {
  if (!shown) return null;
  return (
    <div className="ux4g-alert ux4g-alert-success" role="status">
      <div className="ux4g-alert-content">
        <p className="ux4g-alert-message">Saved.</p>
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
  onChange,
}: {
  id: string;
  label: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string;
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
        required
        onChange={
          onChange
            ? (e) => {
                onChange(e.target.value);
              }
            : undefined
        }
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

const groupOptions = BLOOD_GROUPS.map((g) => ({ value: g, label: bloodGroupLabel(g) }));
const productOptions = PRODUCTS.map((p) => ({ value: p, label: productLabel(p) }));

/* -------------------------------------------------------------------------- */
/* Intake                                                                      */
/* -------------------------------------------------------------------------- */

export function BagForm({
  today,
  shelfLives,
  tagUid = '',
}: {
  today: string;
  shelfLives: Record<string, number>;
  /** Prefilled when the operator arrived here from scanning a free tag (§4). */
  tagUid?: string;
}) {
  const [state, action] = useActionState(registerBagAction, initial);
  const [product, setProduct] = useState<string>('prbc');
  const [collectedAt, setCollectedAt] = useState<string>(today);

  const shelfLife = shelfLives[product];
  const derived =
    shelfLife === undefined || collectedAt === ''
      ? null
      : new Date(new Date(`${collectedAt}T00:00:00Z`).getTime() + shelfLife * 86_400_000)
          .toISOString()
          .slice(0, 10);

  return (
    <form action={action} className="app-stack" noValidate>
      <Problem message={state.error} />

      <Field
        id="unitNumber"
        label={WORDING.unitNumber}
        required
        hint="Typed, or read from the bag by a scanner acting as a keyboard."
      />
      <Select id="bloodGroup" label={WORDING.bloodGroupAndRh} options={groupOptions} />
      <Select
        id="product"
        label={WORDING.product}
        options={productOptions}
        defaultValue="prbc"
        onChange={setProduct}
      />

      <div className="ux4g-form-group app-stack-tight">
        <label className="ux4g-label-l-strong" htmlFor="collectedAt">
          {WORDING.collectedOn}
        </label>
        <input
          className="ux4g-input ux4g-input-lg"
          id="collectedAt"
          name="collectedAt"
          type="date"
          required
          max={today}
          defaultValue={today}
          onChange={(e) => {
            setCollectedAt(e.target.value);
          }}
          aria-describedby="collectedAt-hint"
        />
        <p className="ux4g-label-m-default" id="collectedAt-hint">
          {/* The clock runs from collection, never from intake or a re-scan. */}
          The expiry is counted from this day, not from today.
        </p>
      </div>

      {derived ? (
        <div className="ux4g-alert ux4g-alert-info" role="status">
          <div className="ux4g-alert-content">
            <p className="ux4g-alert-message">
              {WORDING.expiresOn}: <span className="app-figure">{derived}</span>:{' '}
              {shelfLife} days for {productLabel(product as never)}.
            </p>
          </div>
        </div>
      ) : null}

      <Field
        id="labelExpiry"
        label="Expiry printed on the bag"
        type="date"
        hint="Only if the bag carries one. The printed label wins, and a disagreement is flagged for you to check, not silently accepted."
      />
      <Field
        id="tagUid"
        label="Tag identifier"
        defaultValue={tagUid}
        hint="If this bag carries a tag."
      />
      <Field id="source" label="Source" hint="Camp, replacement donor, transfer in." />

      <Submit label="Register the bag" busy="Registering…" />
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* The decision                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Two buttons, one form, and no units field.
 *
 * How many units are issued is not the operator's to type: it is whatever the
 * shelf holds at the instant the transaction runs, and a number entered thirty
 * seconds earlier is a number that may already be wrong. The screen says what
 * is on hand and what will happen; the transaction decides the figure.
 */
export function DecisionForm({
  requestUuid,
  units,
  available,
  recruits,
}: {
  requestUuid: string;
  units: number;
  available: number;
  recruits: boolean;
}) {
  const [state, issue] = useActionState(
    decideRequestAction.bind(null, requestUuid, 'issue'),
    initial,
  );
  const [declineState, decline] = useActionState(
    decideRequestAction.bind(null, requestUuid, 'decline'),
    initial,
  );

  const shortfall = Math.max(0, units - available);

  return (
    <div className="app-stack">
      <Problem message={state.error ?? declineState.error} />

      <div className="ux4g-alert ux4g-alert-info" role="status">
        <div className="ux4g-alert-content">
          <p className="ux4g-alert-message">
            {available >= units
              ? `All ${units} units can be issued from stock.`
              : `${available} of ${units} units are on the shelf.`}
            {shortfall > 0 && recruits
              ? ` The remaining ${shortfall} will raise a ${WORDING.donorDemand.toLowerCase()} in the same transaction.`
              : null}
            {shortfall > 0 && !recruits
              ? ' This component is separated in a lab, so no donors are recruited for it.'
              : null}
          </p>
        </div>
      </div>

      <form action={issue} className="app-stack">
        <div className="ux4g-form-group app-stack-tight">
          <label className="ux4g-label-l-strong" htmlFor="note">
            Note <span className="ux4g-label-m-default">(optional)</span>
          </label>
          <textarea className="ux4g-input ux4g-input-lg" id="note" name="note" rows={2} />
        </div>
        <Submit
          label={available >= units ? 'Issue the units' : 'Issue what is on the shelf'}
          busy="Answering…"
        />
      </form>

      <form action={decline} className="app-stack">
        <div className="ux4g-form-group app-stack-tight">
          <label className="ux4g-label-l-strong" htmlFor="declineNote">
            Reason for declining
          </label>
          <textarea
            className="ux4g-input ux4g-input-lg"
            id="declineNote"
            name="note"
            rows={2}
            required
          />
          <p className="ux4g-label-m-default">
            {/* Declining on the merits is not a shortfall, so it recruits nobody. */}
            Declining answers the request without issuing anything and without
            recruiting donors. Use it for a duplicate or a request the centre is
            refusing, not for an empty shelf.
          </p>
        </div>
        <Submit label="Decline the request" busy="Answering…" tone="outline-danger" />
      </form>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Demand                                                                      */
/* -------------------------------------------------------------------------- */

export function CancelDemandForm({ demandId }: { demandId: string }) {
  const [state, action] = useActionState(cancelDemandAction.bind(null, demandId), initial);
  const [open, setOpen] = useState(false);

  if (state.done) {
    return <p className="ux4g-body-s-default">Withdrawn. Donors are being stood down.</p>;
  }

  if (!open) {
    return (
      <button
        type="button"
        className="ux4g-btn ux4g-btn-text-neutral ux4g-btn-md app-target"
        onClick={() => {
          setOpen(true);
        }}
      >
        Withdraw
      </button>
    );
  }

  return (
    <form action={action} className="app-stack-tight">
      <Problem message={state.error} />
      <label className="ux4g-label-m-strong" htmlFor={`reason-${demandId}`}>
        Why is this being withdrawn?
      </label>
      <input
        className="ux4g-input ux4g-input-md"
        id={`reason-${demandId}`}
        name="reason"
        required
      />
      <p className="ux4g-label-m-default">
        {/* §7.6: the closure and the stand-down messages are one pass. */}
        Every donor holding a unit for this is told it has ended.
      </p>
      <Submit label="Withdraw the demand" busy="Withdrawing…" tone="outline-danger" />
    </form>
  );
}

export function RecruitButton({ shortGroups }: { shortGroups: number }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className="ux4g-btn ux4g-btn-primary ux4g-btn-md app-target"
      disabled={pending || shortGroups === 0}
      aria-disabled={pending || shortGroups === 0}
    >
      {shortGroups === 0
        ? 'Every group is above the floor'
        : pending
          ? 'Raising…'
          : `Recruit for ${shortGroups} ${shortGroups === 1 ? 'group' : 'groups'} below the floor`}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

export function SettingsForm({
  hospitalName,
  address,
  districtId,
  cityId,
  minUnitsPerGroup,
  returnTimeLimitMinutes,
  districts,
}: {
  hospitalName: string;
  address: string;
  districtId: string | null;
  cityId: string | null;
  minUnitsPerGroup: number;
  returnTimeLimitMinutes: number;
  districts: readonly { id: string; name: string }[];
}) {
  const [state, action] = useActionState(updateSettingsAction, initial);

  return (
    <form action={action} className="app-stack" noValidate>
      <Problem message={state.error} />
      <Saved shown={state.done === true} />

      <Field id="hospitalName" label="Hospital name" defaultValue={hospitalName} required />
      <div className="ux4g-form-group app-stack-tight">
        <label className="ux4g-label-l-strong" htmlFor="address">
          Address
        </label>
        <textarea
          className="ux4g-input ux4g-input-lg"
          id="address"
          name="address"
          rows={3}
          defaultValue={address}
          required
          aria-describedby="address-hint"
        />
        <p className="ux4g-label-m-default" id="address-hint">
          {/* Snapshotted onto every new demand, never retroactively (§2.6). */}
          Donors are told to come here. Changing it changes what the next donor is
          told, never what the last one was told.
        </p>
      </div>

      <div className="ux4g-form-group app-stack-tight">
        <label className="ux4g-label-l-strong" htmlFor="districtId">
          District
        </label>
        <select
          className="ux4g-form-select ux4g-form-select-lg"
          id="districtId"
          name="districtId"
          defaultValue={districtId ?? ''}
        >
          <option value="">Not set</option>
          {districts.map((district) => (
            <option key={district.id} value={district.id}>
              {district.name}
            </option>
          ))}
        </select>
        <p className="ux4g-label-m-default">
          Recruitment orders donors by how near they are. Without a district, no
          demand can be raised at all.
        </p>
      </div>
      <input type="hidden" name="cityId" value={cityId ?? ''} />

      <Field
        id="minUnitsPerGroup"
        label={WORDING.stockFloor}
        type="number"
        inputMode="numeric"
        min="0"
        defaultValue={String(minUnitsPerGroup)}
        required
        hint="Red cells per blood group. Below this, the group is offered for recruitment."
      />
      <Field
        id="returnTimeLimitMinutes"
        label="Return time limit (minutes)"
        type="number"
        inputMode="numeric"
        min="0"
        defaultValue={String(returnTimeLimitMinutes)}
        required
        hint="From your own transfusion SOP. Used by the return flow, which arrives in a later phase."
      />

      <Submit label="Save settings" busy="Saving…" />
    </form>
  );
}

export function ShelfLifeForm({ product, days }: { product: string; days: number }) {
  const [state, action] = useActionState(setShelfLifeAction.bind(null, product), initial);

  return (
    <form action={action} className="app-row">
      <label className="app-sr-only" htmlFor={`days-${product}`}>
        Shelf life for {productLabel(product as never)}
      </label>
      <input
        className="ux4g-input ux4g-input-md"
        id={`days-${product}`}
        name="days"
        type="number"
        inputMode="numeric"
        min="1"
        defaultValue={String(days)}
        required
        style={{ maxWidth: '8rem' }}
      />
      <button type="submit" className="ux4g-btn ux4g-btn-outline-primary ux4g-btn-md app-target">
        {state.done === true ? 'Saved' : 'Save'}
      </button>
      {state.error ? <span className="ux4g-label-m-default">{state.error}</span> : null}
    </form>
  );
}
