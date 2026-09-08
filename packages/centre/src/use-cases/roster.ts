/**
 * What happened at the counter (§4, §8.3).
 *
 * **The counter is the authority on who gave blood.** The bot knows who said
 * yes; only the person at the desk knows who turned up, what was collected, and
 * what it typed as. §4 puts it plainly: getting a donor's interval right matters
 * more than tidy state.
 *
 * The centre writes exactly five columns here — `status`, `donated_at`,
 * `bag_identifier`, `donated_blood_group` and `marked_by` — and the grants make
 * that true rather than merely intended. It cannot invent a roster row, because
 * somebody who never confirmed in the bot is a **walk-in**, which is its own
 * record rather than a fabricated confirmation.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import { err, ok, type Result } from '@blood-connect/result';
import {
  bloodBags,
  donorDemand,
  donorDemandConfirmations,
  walkInDonations,
} from '@blood-connect/db';
import { isBloodGroup, type BloodGroup } from '@blood-connect/domain';
import {
  actorHas,
  createAuditWriter,
  type UseCaseContext,
} from '@blood-connect/platform';

import {
  demandNotFound,
  invalidBag,
  notAuthorized,
  type DemandNotFound,
  type InvalidBag,
  type NotAuthorized,
} from '../errors.js';

export type RosterOutcome = 'completed' | 'no_show' | 'cancelled';

export type RosterRow = {
  readonly id: string;
  readonly donorName: string;
  readonly donorPhone: string;
  readonly bloodGroup: string;
  readonly channel: string;
  readonly status: string;
  readonly confirmedAt: Date;
  readonly donatedAt: string | null;
  readonly bagIdentifier: string | null;
  readonly donatedBloodGroup: string | null;
  readonly acknowledged: boolean;
};

/**
 * The confirmed-donor roster for one demand (§4).
 *
 * Name and verified phone number, which is what the counter needs to recognise
 * somebody at the desk — and the only place a donor's contact details cross into
 * the centre's half of the database. They arrive here because the donor agreed
 * to give for a specific patient, which is exactly what the consent text says.
 */
export async function listRoster(
  ctx: UseCaseContext,
  demandId: string,
): Promise<RosterRow[]> {
  const rows = await ctx.db
    .select({
      id: donorDemandConfirmations.id,
      donorName: donorDemandConfirmations.donorName,
      donorPhone: donorDemandConfirmations.donorPhone,
      bloodGroup: donorDemandConfirmations.bloodGroup,
      channel: donorDemandConfirmations.channel,
      status: donorDemandConfirmations.status,
      confirmedAt: donorDemandConfirmations.confirmedAt,
      donatedAt: donorDemandConfirmations.donatedAt,
      bagIdentifier: donorDemandConfirmations.bagIdentifier,
      donatedBloodGroup: donorDemandConfirmations.donatedBloodGroup,
      acknowledgedAt: donorDemandConfirmations.acknowledgedAt,
    })
    .from(donorDemandConfirmations)
    .where(eq(donorDemandConfirmations.demandId, demandId))
    .orderBy(donorDemandConfirmations.confirmedAt);

  return rows.map(({ acknowledgedAt, ...row }) => ({
    ...row,
    // "The bot has told them" — the counter should not chase somebody the
    // system has already thanked.
    acknowledged: acknowledgedAt !== null,
  }));
}

export type MarkInput = {
  readonly confirmationId: string;
  readonly outcome: RosterOutcome;
  /** The unit collected, which links a donor to a bag (§4). */
  readonly bagIdentifier?: string | null;
  /**
   * The group the unit **typed as**, not the group the donor believes.
   *
   * This is what lets the bot mark their group verified (§7.7), and it is
   * deliberately a separate answer from the one on the roster row: a donor who
   * guessed wrong is exactly the case verification exists for.
   */
  readonly donatedBloodGroup?: string | null;
};

/**
 * Records what happened to one confirmed donor (§8.3).
 *
 * `completed` is the only outcome that takes a unit and a group, because it is
 * the only one where a unit was collected. A no-show frees the place, which the
 * bot then promotes the waitlist into.
 */
export async function markRosterOutcome(
  ctx: UseCaseContext,
  input: MarkInput,
): Promise<Result<{ confirmationId: string }, NotAuthorized | InvalidBag>> {
  if (!actorHas(ctx.actor, 'centre:operate')) return err(notAuthorized('centre:operate'));

  const identifier = input.bagIdentifier?.trim() ?? '';
  const group = input.donatedBloodGroup?.trim() ?? '';

  if (input.outcome === 'completed') {
    if (identifier.length === 0) {
      // Without it, nothing links this donor to the unit that came from them,
      // and §4 requires that trace.
      return err(invalidBag('Record the unit number collected. It links the donor to the bag.'));
    }
    if (group !== '' && !isBloodGroup(group)) {
      return err(invalidBag('That is not a blood group.'));
    }
  }

  const now = ctx.clock.now();
  const actorId = ctx.actor.kind === 'user' ? ctx.actor.userId : null;

  return ctx.db.transaction(async (tx) => {
    /**
     * A conditional UPDATE guarded on `confirmed` (§7.4).
     *
     * A donor is marked once. Two counter staff working the same roster, or one
     * tapping twice, must not roll an interval forward twice — and the bot's
     * `acknowledged_at` marker is only safe because this is.
     */
    const moved = await tx
      .update(donorDemandConfirmations)
      .set({
        status: input.outcome,
        donatedAt: input.outcome === 'completed' ? ctx.clock.today() : null,
        bagIdentifier: input.outcome === 'completed' ? identifier : null,
        donatedBloodGroup:
          input.outcome === 'completed' && group !== '' ? (group as BloodGroup) : null,
        markedBy: actorId,
      })
      .where(
        and(
          eq(donorDemandConfirmations.id, input.confirmationId),
          eq(donorDemandConfirmations.status, 'confirmed'),
        ),
      )
      .returning({ id: donorDemandConfirmations.id, demandId: donorDemandConfirmations.demandId });

    const row = moved[0];
    if (!row) {
      return err(invalidBag('That donor has already been marked, or is not on this roster.'));
    }

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'roster.marked',
      subjectType: 'donor_demand_confirmation',
      subjectId: row.id,
      // The donor id is on the row; a name here would put one in the log (§11.9).
      metadata: {
        demandId: row.demandId,
        outcome: input.outcome,
        bagIdentifier: input.outcome === 'completed' ? identifier : null,
        donatedBloodGroup: group === '' ? null : group,
      },
    });

    return ok({ confirmationId: row.id });
  });
}

/* -------------------------------------------------------------------------- */
/* Walk-ins                                                                    */
/* -------------------------------------------------------------------------- */

export type WalkInInput = {
  readonly demandId: string;
  readonly donorName: string;
  readonly donorPhone: string;
  readonly bloodGroup: string;
  readonly bagIdentifier: string;
};

/**
 * Somebody who gave blood without ever confirming in the bot (§4).
 *
 * "The centre is the authority on who gave blood; getting a donor's interval
 * right matters more than tidy state." A walk-in is how most first donations
 * actually happen, and refusing to record one because the person is not in the
 * bot would lose the donation from the count and the donor from the pool.
 *
 * **It is not a confirmation row**, and the first version of this that tried to
 * make it one was refused by the database the moment it ran as `app_web` rather
 * than as the test suite's `migrator`:
 *
 *     permission denied for table donor_demand_confirmations
 *
 * The refusal was right (§5.1). The bot creates the roster; the centre records
 * what happened at the counter. So a walk-in goes in the centre's own table,
 * which the bot reads to stop recruiting for a unit it already has
 * (contract 1.2.0).
 */
export async function recordWalkIn(
  ctx: UseCaseContext,
  input: WalkInInput,
): Promise<Result<{ walkInId: string }, NotAuthorized | InvalidBag | DemandNotFound>> {
  if (!actorHas(ctx.actor, 'centre:operate')) return err(notAuthorized('centre:operate'));

  const name = input.donorName.trim();
  const phone = input.donorPhone.trim();
  const identifier = input.bagIdentifier.trim();

  if (name.length === 0) return err(invalidBag('Record the donor’s name.'));
  if (phone.length === 0) return err(invalidBag('Record a phone number for the donor.'));
  if (identifier.length === 0) return err(invalidBag('Record the unit number collected.'));
  if (!isBloodGroup(input.bloodGroup)) return err(invalidBag('Choose the group the unit typed as.'));

  const now = ctx.clock.now();
  const actorId = ctx.actor.kind === 'user' ? ctx.actor.userId : null;
  const walkInId = ctx.ids.next<'WalkInId'>();

  return ctx.db.transaction(async (tx) => {
    const [demand] = await tx
      .select({ id: donorDemand.id })
      .from(donorDemand)
      .where(eq(donorDemand.id, input.demandId));

    if (!demand) return err(demandNotFound());

    await tx.insert(walkInDonations).values({
      id: walkInId,
      demandId: input.demandId,
      donorName: name,
      donorPhone: phone,
      bloodGroup: input.bloodGroup,
      bagIdentifier: identifier,
      donatedOn: ctx.clock.today(),
      recordedBy: actorId,
    });

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'roster.walk_in',
      subjectType: 'walk_in_donation',
      subjectId: walkInId,
      // No name and no number: the row holds those, the log does not (§11.9).
      metadata: {
        demandId: input.demandId,
        bagIdentifier: identifier,
        bloodGroup: input.bloodGroup,
      },
    });

    return ok({ walkInId });
  });
}

export type WalkInRow = {
  readonly id: string;
  readonly donorName: string;
  readonly donorPhone: string;
  readonly bloodGroup: string;
  readonly bagIdentifier: string;
  readonly donatedOn: string;
};

/** Walk-ins against one demand, for the roster page. */
export async function listWalkIns(
  ctx: UseCaseContext,
  demandId: string,
): Promise<WalkInRow[]> {
  return ctx.db
    .select({
      id: walkInDonations.id,
      donorName: walkInDonations.donorName,
      donorPhone: walkInDonations.donorPhone,
      bloodGroup: walkInDonations.bloodGroup,
      bagIdentifier: walkInDonations.bagIdentifier,
      donatedOn: walkInDonations.donatedOn,
    })
    .from(walkInDonations)
    .where(eq(walkInDonations.demandId, demandId))
    .orderBy(walkInDonations.createdAt);
}

/**
 * The unit numbers a counter can pick from when marking a donation.
 *
 * Bags registered today and still available — which is what a unit collected
 * from a donor at this desk looks like a few minutes later. A free-text field
 * would let a typo link a donor to somebody else's unit.
 */
export async function todaysUnits(
  ctx: UseCaseContext,
  limit = 50,
): Promise<{ unitNumber: string; bloodGroup: string }[]> {
  return ctx.db
    .select({ unitNumber: bloodBags.unitNumber, bloodGroup: bloodBags.bloodGroup })
    .from(bloodBags)
    .where(
      and(
        eq(bloodBags.collectedAt, ctx.clock.today()),
        sql`${bloodBags.status} IN ('available', 'quarantined')`,
      ),
    )
    .orderBy(bloodBags.unitNumber)
    .limit(limit);
}

/** Confirmations the counter has not yet marked, for the demand page. */
export async function countUnmarked(ctx: UseCaseContext, demandId: string): Promise<number> {
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(donorDemandConfirmations)
    .where(
      and(
        eq(donorDemandConfirmations.demandId, demandId),
        eq(donorDemandConfirmations.status, 'confirmed'),
        isNull(donorDemandConfirmations.donatedAt),
      ),
    );

  return row?.n ?? 0;
}
