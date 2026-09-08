'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import {
  cancelDemand,
  decideRequest,
  discardBag,
  markRosterOutcome,
  raiseTagDiscrepancy,
  recordWalkIn,
  recruitForFloor,
  registerBag,
  releaseTag,
  resolveQuarantine,
  resolveTagDiscrepancy,
  returnBag,
  setShelfLife,
  stockByGroup,
  updateCentreSettings,
  type DiscrepancyFinding,
  type ReturnOutcome,
  type RosterOutcome,
  type StorageBand,
} from '@blood-connect/centre';
import { useCaseContext } from '@/lib/guards';
import { assertSameOrigin, currentActor } from '@/lib/session';

/**
 * Module 2's server actions (§9.1).
 *
 * Each parses input and calls exactly one use case. The counter is never in the
 * form — it comes from the session inside the use case (§2.5) — and no action
 * here decides anything: which bags are claimed, whether a demand is raised and
 * what the answer is called are all settled inside the transaction.
 */

export type FormState = { readonly error: string | null; readonly done?: boolean };

function value(form: FormData, name: string): string {
  const raw = form.get(name);
  return typeof raw === 'string' ? raw.trim() : '';
}

const optional = (form: FormData, name: string): string | null =>
  value(form, name) === '' ? null : value(form, name);

/* -------------------------------------------------------------------------- */
/* Intake                                                                      */
/* -------------------------------------------------------------------------- */

export async function registerBagAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const ctx = await useCaseContext(await currentActor());
  const result = await registerBag(ctx, {
    unitNumber: value(formData, 'unitNumber'),
    bloodGroup: value(formData, 'bloodGroup'),
    product: value(formData, 'product'),
    collectedAt: value(formData, 'collectedAt'),
    source: optional(formData, 'source'),
    labelExpiry: optional(formData, 'labelExpiry'),
    tagUid: optional(formData, 'tagUid'),
  });

  if (!result.ok) return { error: result.error.message };

  revalidatePath('/centre/stock');
  revalidatePath('/centre');

  // A mismatch is flagged, not blocked (§4) — so the operator lands on the
  // register with the bag in it and a message telling them to check the label
  // against the unit in their hand.
  redirect(
    result.value.expiryMismatch
      ? `/centre/stock?flagged=${encodeURIComponent(result.value.bagId)}`
      : '/centre/stock?added=1',
  );
}

/* -------------------------------------------------------------------------- */
/* The decision                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The one action §7.2 exists for.
 *
 * It passes an intent — fill it, or refuse it — and nothing else. How many
 * units are issued is whatever the shelf holds at the instant the transaction
 * runs, which is the only number that can be true.
 */
export async function decideRequestAction(
  requestUuid: string,
  action: 'issue' | 'decline',
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const ctx = await useCaseContext(await currentActor());
  const result = await decideRequest(ctx, {
    requestUuid,
    action,
    note: optional(formData, 'note'),
  });

  if (!result.ok) return { error: result.error.message };

  revalidatePath('/centre/requests');
  revalidatePath('/centre');
  redirect(`/centre/requests/${requestUuid}`);
}

/* -------------------------------------------------------------------------- */
/* Demand                                                                      */
/* -------------------------------------------------------------------------- */

export async function recruitForFloorAction(): Promise<void> {
  await assertSameOrigin();

  const ctx = await useCaseContext(await currentActor());

  // The shortfalls are recomputed here rather than posted from the page: a
  // number the browser sends is a number that was true when the page rendered,
  // and stock moves between a page load and a button press.
  const stock = await stockByGroup(ctx);
  const shortfalls = stock
    .filter((row) => row.short > 0)
    .map((row) => ({
      bloodGroup: row.bloodGroup,
      onShelf: row.onShelf,
      floor: row.floor,
      short: row.short,
    }));

  await recruitForFloor(ctx, shortfalls);

  revalidatePath('/centre');
  revalidatePath('/centre/demands');
}

export async function cancelDemandAction(
  demandId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const reason = value(formData, 'reason');
  if (reason.length === 0) {
    return { error: 'Say why this is being withdrawn. Donors are told it has ended.' };
  }

  const ctx = await useCaseContext(await currentActor());
  const result = await cancelDemand(ctx, demandId, reason);
  if (!result.ok) return { error: result.error.message };

  revalidatePath('/centre/demands');
  revalidatePath(`/centre/demands/${demandId}`);
  return { error: null, done: true };
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

export async function updateSettingsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const ctx = await useCaseContext(await currentActor());
  const result = await updateCentreSettings(ctx, {
    hospitalName: value(formData, 'hospitalName'),
    address: value(formData, 'address'),
    districtId: optional(formData, 'districtId'),
    cityId: optional(formData, 'cityId'),
    minUnitsPerGroup: Number(value(formData, 'minUnitsPerGroup') || '0'),
    returnTimeLimitMinutes: Number(value(formData, 'returnTimeLimitMinutes') || '0'),
  });

  if (!result.ok) return { error: result.error.message };

  revalidatePath('/centre/settings');
  revalidatePath('/centre');
  return { error: null, done: true };
}

export async function setShelfLifeAction(
  product: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const ctx = await useCaseContext(await currentActor());
  const result = await setShelfLife(ctx, product, Number(value(formData, 'days') || '0'));
  if (!result.ok) return { error: result.error.message };

  revalidatePath('/centre/settings');
  return { error: null, done: true };
}

/* -------------------------------------------------------------------------- */
/* The three collision cases (§4)                                              */
/* -------------------------------------------------------------------------- */

export async function lookUpTagAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await assertSameOrigin();
  const tag = value(formData, 'tagUid');
  if (tag === '') return { error: 'Enter or scan a tag identifier.' };
  redirect(`/centre/tags?tag=${encodeURIComponent(tag)}`);
}

/** Case 1. The outcome is constrained by the band — see `allowedOutcomes`. */
export async function returnBagAction(
  bagId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const ctx = await useCaseContext(await currentActor());
  const result = await returnBag(ctx, {
    bagId,
    outOfStorageBand: value(formData, 'outOfStorageBand') as StorageBand,
    coldChainDocumented: formData.get('coldChainDocumented') === 'on',
    outcome: value(formData, 'outcome') as ReturnOutcome,
    note: optional(formData, 'note'),
    disposalRoute: optional(formData, 'disposalRoute'),
  });

  if (!result.ok) return { error: result.error.message };

  revalidatePath('/centre/tags');
  revalidatePath('/centre/stock');
  return { error: null, done: true };
}

/** Case 2, step one. Re-registering is the normal intake form, separately. */
export async function releaseTagAction(
  tagUid: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const ctx = await useCaseContext(await currentActor());
  const result = await releaseTag(ctx, tagUid, value(formData, 'reason'), {
    retire: formData.get('retire') === 'on',
  });

  if (!result.ok) return { error: result.error.message };

  revalidatePath('/centre/tags');
  return { error: null, done: true };
}

/** Case 3. No resolution here — it raises the alarm and stops (§7.5). */
export async function raiseDiscrepancyAction(
  tagUid: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const ctx = await useCaseContext(await currentActor());
  const result = await raiseTagDiscrepancy(ctx, tagUid, value(formData, 'note'));
  if (!result.ok) return { error: result.error.message };

  revalidatePath('/centre/tags');
  return { error: null, done: true };
}

/** One of exactly three endings, each needing a name and what was found (§4). */
export async function resolveDiscrepancyAction(
  discrepancyId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const ctx = await useCaseContext(await currentActor());
  const result = await resolveTagDiscrepancy(
    ctx,
    discrepancyId,
    value(formData, 'finding') as DiscrepancyFinding,
    value(formData, 'note'),
  );

  if (!result.ok) return { error: result.error.message };

  revalidatePath('/centre/tags');
  revalidatePath('/centre');
  return { error: null, done: true };
}

/* -------------------------------------------------------------------------- */
/* Quarantine and discards                                                     */
/* -------------------------------------------------------------------------- */

export async function resolveQuarantineAction(
  quarantineId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const ctx = await useCaseContext(await currentActor());
  const result = await resolveQuarantine(
    ctx,
    quarantineId,
    value(formData, 'resolution') === 'available' ? 'available' : 'discarded',
    value(formData, 'note'),
    value(formData, 'disposalRoute'),
  );

  if (!result.ok) return { error: result.error.message };

  revalidatePath('/centre/quarantine');
  revalidatePath('/centre');
  return { error: null, done: true };
}

export async function discardBagAction(
  bagId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const ctx = await useCaseContext(await currentActor());
  const result = await discardBag(
    ctx,
    bagId,
    value(formData, 'reason'),
    value(formData, 'disposalRoute'),
    optional(formData, 'note'),
  );

  if (!result.ok) return { error: result.error.message };

  revalidatePath('/centre/stock');
  return { error: null, done: true };
}

/* -------------------------------------------------------------------------- */
/* The roster (§4)                                                             */
/* -------------------------------------------------------------------------- */

/**
 * What happened to one confirmed donor.
 *
 * The typed group is asked for separately from the group on the roster row,
 * because a donor who guessed wrong is exactly the case verification exists for
 * — and it is what lets the bot mark them verified at all (contract 1.1.0).
 */
export async function markRosterAction(
  confirmationId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const ctx = await useCaseContext(await currentActor());
  const result = await markRosterOutcome(ctx, {
    confirmationId,
    outcome: value(formData, 'outcome') as RosterOutcome,
    bagIdentifier: optional(formData, 'bagIdentifier'),
    donatedBloodGroup: optional(formData, 'donatedBloodGroup'),
  });

  if (!result.ok) return { error: result.error.message };

  revalidatePath('/centre/demands');
  // Every roster, because the confirmation id does not name its demand here.
  revalidatePath('/centre/demands/[id]', 'page');
  return { error: null, done: true };
}

export async function recordWalkInAction(
  demandId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertSameOrigin();

  const ctx = await useCaseContext(await currentActor());
  const result = await recordWalkIn(ctx, {
    demandId,
    donorName: value(formData, 'donorName'),
    donorPhone: value(formData, 'donorPhone'),
    bloodGroup: value(formData, 'bloodGroup'),
    bagIdentifier: value(formData, 'bagIdentifier'),
  });

  if (!result.ok) return { error: result.error.message };

  revalidatePath('/centre/demands');
  return { error: null, done: true };
}
