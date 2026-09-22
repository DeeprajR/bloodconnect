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

function Saved({ shown }: { shown: boolean }) {
  if (!shown) return null;
  return (
    <p
      role="status"
      className="rounded-control border border-success/30 bg-success-soft px-3 py-2 text-sm text-ink"
    >
      Saved.
    </p>
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
    <form action={action} className="space-y-4" noValidate>
      <Problem message={state.error} />

      <FormField
        label={WORDING.unitNumber}
        hint="Typed, or read from the bag by a scanner acting as a keyboard."
        required
      >
        {(p) => <TextInput {...p} name="unitNumber" required />}
      </FormField>

      <FormField label={WORDING.bloodGroupAndRh} required>
        {(p) => (
          <Select {...p} name="bloodGroup" required>
            {groupOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField label={WORDING.product} required>
        {(p) => (
          <Select
            {...p}
            name="product"
            defaultValue="prbc"
            required
            onChange={(e) => {
              setProduct(e.target.value);
            }}
          >
            {productOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField
        label={WORDING.collectedOn}
        // The clock runs from collection, never from intake or a re-scan.
        hint="The expiry is counted from this day, not from today."
      >
        {(p) => (
          <TextInput
            {...p}
            name="collectedAt"
            type="date"
            required
            max={today}
            defaultValue={today}
            onChange={(e) => {
              setCollectedAt(e.target.value);
            }}
          />
        )}
      </FormField>

      {derived ? (
        <p
          role="status"
          className="rounded-control border border-info/30 bg-info-soft px-3 py-2 text-sm text-ink"
        >
          {WORDING.expiresOn}: <span className="font-medium tabular-nums">{derived}</span>:{' '}
          {shelfLife} days for {productLabel(product as never)}.
        </p>
      ) : null}

      <FormField
        label="Expiry printed on the bag"
        hint="Only if the bag carries one. The printed label wins, and a disagreement is flagged for you to check, not silently accepted."
      >
        {(p) => <TextInput {...p} name="labelExpiry" type="date" />}
      </FormField>
      <FormField label="Tag identifier" hint="If this bag carries a tag.">
        {(p) => <TextInput {...p} name="tagUid" defaultValue={tagUid} />}
      </FormField>
      <FormField label="Source" hint="Camp, replacement donor, transfer in.">
        {(p) => <TextInput {...p} name="source" />}
      </FormField>

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
    <div className="space-y-4">
      <Problem message={state.error ?? declineState.error} />

      <p
        role="status"
        className="rounded-control border border-info/30 bg-info-soft px-3 py-2 text-sm text-ink"
      >
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

      <form action={issue} className="space-y-4">
        <FormField label="Note">
          {(p) => <TextArea {...p} name="note" rows={2} />}
        </FormField>
        <Submit
          label={available >= units ? 'Issue the units' : 'Issue what is on the shelf'}
          busy="Answering…"
        />
      </form>

      <form action={decline} className="space-y-4">
        <FormField
          label="Reason for declining"
          // Declining on the merits is not a shortfall, so it recruits nobody.
          hint="Declining answers the request without issuing anything and without recruiting donors. Use it for a duplicate or a request the centre is refusing, not for an empty shelf."
          required
        >
          {(p) => <TextArea {...p} name="note" rows={2} required />}
        </FormField>
        <Submit label="Decline the request" busy="Answering…" variant="danger" />
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
    return <p className="text-sm text-ink-muted">Withdrawn. Donors are being stood down.</p>;
  }

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
        Withdraw
      </Button>
    );
  }

  return (
    <form action={action} className="space-y-2">
      <Problem message={state.error} />
      <TextInput name="reason" placeholder="Why is this being withdrawn?" required aria-label="Why is this being withdrawn?" />
      <p className="text-xs text-ink-subtle">
        {/* §7.6: the closure and the stand-down messages are one pass. */}
        Every donor holding a unit for this is told it has ended.
      </p>
      <Submit label="Withdraw the demand" busy="Withdrawing…" variant="danger" />
    </form>
  );
}

export function RecruitButton({ shortGroups }: { shortGroups: number }) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      loading={pending}
      disabled={pending || shortGroups === 0}
    >
      {shortGroups === 0
        ? 'Every group is above the floor'
        : pending
          ? 'Raising…'
          : `Recruit for ${shortGroups} ${shortGroups === 1 ? 'group' : 'groups'} below the floor`}
    </Button>
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
    <form action={action} className="space-y-4" noValidate>
      <Problem message={state.error} />
      <Saved shown={state.done === true} />

      <FormField label="Hospital name" required>
        {(p) => <TextInput {...p} name="hospitalName" defaultValue={hospitalName} required />}
      </FormField>

      <FormField
        label="Address"
        // Snapshotted onto every new demand, never retroactively (§2.6).
        hint="Donors are told to come here. Changing it changes what the next donor is told, never what the last one was told."
        required
      >
        {(p) => (
          <TextArea {...p} name="address" rows={3} defaultValue={address} required />
        )}
      </FormField>

      <FormField
        label="District"
        hint="Recruitment orders donors by how near they are. Without a district, no demand can be raised at all."
      >
        {(p) => (
          <Select {...p} name="districtId" defaultValue={districtId ?? ''}>
            <option value="">Not set</option>
            {districts.map((district) => (
              <option key={district.id} value={district.id}>
                {district.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <input type="hidden" name="cityId" value={cityId ?? ''} />

      <FormField
        label={WORDING.stockFloor}
        hint="Red cells per blood group. Below this, the group is offered for recruitment."
        required
      >
        {(p) => (
          <TextInput
            {...p}
            name="minUnitsPerGroup"
            type="number"
            inputMode="numeric"
            min="0"
            defaultValue={String(minUnitsPerGroup)}
            required
          />
        )}
      </FormField>
      <FormField
        label="Return time limit (minutes)"
        hint="From your own transfusion SOP. Used by the return flow, which arrives in a later phase."
        required
      >
        {(p) => (
          <TextInput
            {...p}
            name="returnTimeLimitMinutes"
            type="number"
            inputMode="numeric"
            min="0"
            defaultValue={String(returnTimeLimitMinutes)}
            required
          />
        )}
      </FormField>

      <Submit label="Save settings" busy="Saving…" />
    </form>
  );
}

export function ShelfLifeForm({ product, days }: { product: string; days: number }) {
  const [state, action] = useActionState(setShelfLifeAction.bind(null, product), initial);

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <TextInput
        name="days"
        type="number"
        inputMode="numeric"
        min="1"
        defaultValue={String(days)}
        required
        aria-label={`Shelf life for ${productLabel(product as never)}`}
        className="w-24"
      />
      <Button type="submit" variant="secondary" size="sm">
        {state.done === true ? 'Saved' : 'Save'}
      </Button>
      {state.error ? <span className="text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}
