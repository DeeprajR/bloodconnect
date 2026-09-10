/**
 * Raising and withdrawing demand (§4, §6, §7).
 *
 * A demand is a message to real people asking them to give blood, so two rules
 * hold everywhere in this file:
 *
 *  1. **Only whole blood and packed red cells recruit.** Platelets, plasma and
 *     cryoprecipitate are separated in a lab; they are not what a walk-in donor
 *     produces on the day (§4). The rule lives in `packages/domain`, the CHECK
 *     constraint enforces it, and `raiseDemand` refuses it as well.
 *  2. **What donors are told is snapshotted at the moment it is raised** (§2.6).
 *     Correcting the hospital's address next month must not rewrite a message
 *     somebody already acted on.
 *
 * The centre writes only its own columns here. The bot's progress counters are
 * not merely left alone: `app_web` holds no grant on them, so a mistake in
 * this file fails at the database rather than corrupting a recruitment count.
 */

import { and, eq, sql } from 'drizzle-orm';
import { err, ok, type Result } from '@blood-connect/result';
import { centreSettings, donorDemand } from '@blood-connect/db';
import { recruitsDonors, type BloodGroup, type Product } from '@blood-connect/domain';
import type { IdGenerator } from '@blood-connect/ids';
import {
  actorHas,
  createAuditWriter,
  type Transaction,
  type UseCaseContext,
} from '@blood-connect/platform';

import {
  demandNotFound,
  notAuthorized,
  settingsIncomplete,
  type DemandNotFound,
  type NotAuthorized,
  type SettingsIncomplete,
} from '../errors.js';

/** What donors are told, read once and frozen onto the demand. */
export type CentreSnapshot = {
  readonly centreId: string;
  readonly hospitalName: string;
  readonly hospitalAddress: string;
  readonly districtId: string;
  readonly cityId: string | null;
  readonly minUnitsPerGroup: number;
};

/**
 * Reads the settings a demand needs, or says what is missing.
 *
 * A demand with no district is a message telling somebody to come and give
 * blood without saying where, so this refuses rather than raising one with a
 * hole in it. The settings screen is one click away and the error names it.
 */
export async function readCentreSnapshot(
  tx: Transaction,
): Promise<Result<CentreSnapshot, SettingsIncomplete>> {
  const [row] = await tx.select().from(centreSettings).where(eq(centreSettings.id, 1));

  const missing: string[] = [];
  if (!row) missing.push('the centre settings');
  if (row && !row.hospitalName.trim()) missing.push('the hospital name');
  if (row && !row.address.trim()) missing.push('the address');
  if (row && !row.districtId) missing.push('the district');
  if (!row || missing.length > 0) return err(settingsIncomplete(missing));

  return ok({
    centreId: row.centreId,
    hospitalName: row.hospitalName,
    hospitalAddress: row.address,
    districtId: row.districtId ?? '',
    cityId: row.cityId,
    minUnitsPerGroup: row.minUnitsPerGroup,
  });
}

export type DemandInput = {
  readonly trigger: 'request_shortfall' | 'stock_floor';
  readonly bloodRequestId: string | null;
  readonly bloodGroup: BloodGroup;
  readonly product: Product;
  readonly units: number;
  readonly dateRequired: string;
  readonly notes: string | null;
};

/**
 * Inserts one demand, inside a transaction the caller already owns.
 *
 * Takes a `Transaction` rather than a context because of the rule §7.2 exists
 * to keep: a shortfall must never be able to exist without its demand row. If
 * this opened its own transaction, a crash between the decision commit and the
 * demand commit would leave a request answered short and nobody recruited,
 * which is precisely the silent failure this system is built to avoid.
 *
 * Returns `undefined` when `onConflictDoNothing` swallowed the insert, which
 * only happens for a `stock_floor` demand that is already open for that group.
 */
export async function raiseDemand(
  tx: Transaction,
  centre: CentreSnapshot,
  ids: IdGenerator,
  input: DemandInput,
): Promise<string | undefined> {
  if (!recruitsDonors(input.product)) {
    // Unreachable through the use cases, which check first. Here so a future
    // caller cannot make this the one path that sends the wrong message.
    throw new Error(`${input.product} cannot recruit donors (§4)`);
  }

  const id = ids.next<'DemandId'>();

  const rows = await tx
    .insert(donorDemand)
    .values({
      id,
      centreId: centre.centreId,
      trigger: input.trigger,
      bloodRequestId: input.bloodRequestId,
      bloodGroup: input.bloodGroup,
      product: input.product,
      units: input.units,
      dateRequired: input.dateRequired,
      // Snapshotted, never joined (§2.6).
      hospitalName: centre.hospitalName,
      hospitalAddress: centre.hospitalAddress,
      districtId: centre.districtId,
      cityId: centre.cityId,
      notes: input.notes,
      status: 'open',
    })
    // The partial unique index on (centre_id, blood_group) WHERE
    // trigger = 'stock_floor' AND status = 'open' is what makes
    // "recruit for groups below floor" safe to press twice (§5.6).
    .onConflictDoNothing()
    .returning({ id: donorDemand.id });

  return rows[0]?.id;
}

/* -------------------------------------------------------------------------- */
/* Recruit for the floor (§4)                                                  */
/* -------------------------------------------------------------------------- */

export type FloorShortfall = {
  readonly bloodGroup: BloodGroup;
  readonly onShelf: number;
  readonly floor: number;
  readonly short: number;
};

export type RecruitResult = {
  readonly raised: readonly { bloodGroup: BloodGroup; units: number; demandId: string }[];
  readonly alreadyOpen: readonly BloodGroup[];
};

/**
 * One demand per group that is short and has no open floor demand already (§4).
 *
 * Pressing this twice in a row must not double-recruit, and the guarantee is
 * the partial unique index rather than a check-then-insert, two people
 * pressing it at the same instant is exactly the case a read-then-write would
 * get wrong.
 */
export async function recruitForFloor(
  ctx: UseCaseContext,
  shortfalls: readonly FloorShortfall[],
): Promise<Result<RecruitResult, NotAuthorized | SettingsIncomplete>> {
  if (!actorHas(ctx.actor, 'centre:operate')) return err(notAuthorized('centre:operate'));

  const now = ctx.clock.now();
  const today = ctx.clock.today();

  return ctx.db.transaction(async (tx) => {
    const snapshot = await readCentreSnapshot(tx);
    if (!snapshot.ok) return err(snapshot.error);

    const raised: { bloodGroup: BloodGroup; units: number; demandId: string }[] = [];
    const alreadyOpen: BloodGroup[] = [];

    for (const shortfall of shortfalls) {
      if (shortfall.short <= 0) continue;

      const demandId = await raiseDemand(tx, snapshot.value, ctx.ids, {
        trigger: 'stock_floor',
        // A floor demand answers no single request (§5.6).
        bloodRequestId: null,
        bloodGroup: shortfall.bloodGroup,
        // A walk-in donor gives whole blood; the components are made from it.
        product: 'whole_blood',
        units: shortfall.short,
        dateRequired: today,
        notes: `Stock floor: ${shortfall.onShelf} on the shelf against a floor of ${shortfall.floor}.`,
      });

      if (demandId === undefined) {
        alreadyOpen.push(shortfall.bloodGroup);
        continue;
      }
      raised.push({ bloodGroup: shortfall.bloodGroup, units: shortfall.short, demandId });
    }

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    for (const entry of raised) {
      await audit({
        action: 'demand.raised',
        subjectType: 'donor_demand',
        subjectId: entry.demandId,
        metadata: {
          trigger: 'stock_floor',
          bloodGroup: entry.bloodGroup,
          units: entry.units,
        },
      });
    }

    return ok({ raised, alreadyOpen });
  });
}

/* -------------------------------------------------------------------------- */
/* Cancelling (§8)                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Withdraws a demand.
 *
 * The centre sets the status and stops there. It does not send stand-down
 * messages, because it cannot: the donors are the bot's, reached over a channel
 * the centre knows nothing about. The bot's ticker sees `cancelled` and runs
 * §7.6, which fans out every stand-down through its outbox, that indirection
 * is what makes "a demand closed without its stand-down messages sent" a state
 * the system cannot reach.
 *
 * A conditional UPDATE on the statuses the centre may move from (§7.4), so a
 * second cancel is a no-op rather than an error.
 */
export async function cancelDemand(
  ctx: UseCaseContext,
  demandId: string,
  reason: string,
): Promise<Result<Record<string, never>, NotAuthorized | DemandNotFound>> {
  if (!actorHas(ctx.actor, 'centre:operate')) return err(notAuthorized('centre:operate'));

  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const rows = await tx
      .update(donorDemand)
      .set({
        status: 'cancelled',
        notes: sql`coalesce(${donorDemand.notes} || E'\n', '') || ${`Cancelled: ${reason}`}`,
      })
      .where(
        and(
          eq(donorDemand.id, demandId),
          // The centre may withdraw an open or fulfilled demand and nothing
          // else: `packages/contract` holds the same table as data (§6).
          sql`${donorDemand.status} IN ('open', 'fulfilled')`,
        ),
      )
      .returning({ id: donorDemand.id });

    if (rows.length === 0) return err(demandNotFound());

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'demand.cancelled',
      subjectType: 'donor_demand',
      subjectId: demandId,
      metadata: { reason },
    });

    return ok({});
  });
}
