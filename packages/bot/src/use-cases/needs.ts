/**
 * What is needed near a donor right now (§5).
 *
 * The answer to "so what happens next?" for somebody who has registered. §5 has
 * a public demand board; this is the same information narrowed to the one
 * question a registered donor is actually asking: *can I help today?*
 *
 * Two things it does not do:
 *
 *  - **It shows no patient detail.** The hospital, the group, the units and the
 *    day. Never a name, a ward or a diagnosis (§2.10).
 *  - **It does not ask.** Being asked is a wave, with a journey row behind it
 *    (§7.7). This is a list somebody chose to look at, so it neither creates a
 *    journey nor counts as a notification.
 *
 * The compatibility direction is the red-cell one and it runs the other way
 * from recruitment: a wave for group X selects donors who can give **to** X;
 * this asks which open requests **this donor** can answer.
 */

import { and, asc, eq, inArray, notExists, sql } from 'drizzle-orm';
import { botRequests, donorRequests, donors } from '@blood-connect/db/bot';
import {
  compatibleRecipientGroupsFor,
  hasIntervalElapsed,
  parseCalendarDay,
  type BloodGroup,
} from '@blood-connect/domain';

import type { BotContext } from '../context.js';
import type { HospitalSnapshot } from '../messages.js';

export type OpenNeed = {
  readonly publicId: string;
  readonly bloodGroup: string;
  readonly unitsOutstanding: number;
  readonly neededBy: string;
  readonly hospital: HospitalSnapshot;
  /** True when this donor has already been messaged about it. */
  readonly alreadyAsked: boolean;
};

export type DonorStanding = {
  readonly bloodGroup: BloodGroup;
  readonly name: string;
  /** Null when they can give today. */
  readonly eligibleFrom: string | null;
  readonly pausedUntil: string | null;
  /**
   * What their answers came to, and why, as it was decided and stored.
   *
   * Carried here so a donor who is not being messaged can be told which fact is
   * responsible, rather than shown an empty list that reads as "nobody needs
   * blood". Null reason means they qualify.
   */
  readonly qualification: string;
  readonly qualificationReason: string | null;
  readonly needs: readonly OpenNeed[];
};

/**
 * The donor's own situation, plus what is open that they could answer.
 *
 * One query per question rather than one clever join: this runs on a person
 * tapping a button, and a readable answer to "why is this list empty?" matters
 * more here than a round trip.
 */
export async function standingFor(
  ctx: BotContext,
  donorId: string,
): Promise<DonorStanding | undefined> {
  const [donor] = await ctx.db
    .select({
      name: donors.name,
      bloodGroup: donors.bloodGroup,
      nextEligibleOn: donors.nextEligibleOn,
      snoozeUntil: donors.snoozeUntil,
      qualificationStatus: donors.qualificationStatus,
      qualificationReason: donors.qualificationReason,
    })
    .from(donors)
    .where(eq(donors.id, donorId));

  if (!donor) return undefined;

  const today = ctx.clock.today();
  const eligible = parseCalendarDay(donor.nextEligibleOn);
  const canGiveToday = hasIntervalElapsed(eligible, today);

  // Which open requests could this donor's blood answer?
  const answerable = compatibleRecipientGroupsFor(donor.bloodGroup as BloodGroup);

  const rows = await ctx.db
    .select({
      publicId: botRequests.publicId,
      bloodGroup: botRequests.bloodGroup,
      unitsNeeded: botRequests.unitsNeeded,
      confirmedCount: botRequests.confirmedCount,
      walkInUnits: botRequests.walkInUnits,
      neededBy: botRequests.neededBy,
      hospitalSnapshot: botRequests.hospitalSnapshot,
      /**
       * `bot.bot_requests.id` written out, not interpolated.
       *
       * Drizzle renders a column reference inside a select-list `sql` without
       * its table, so `${botRequests.id}` became a bare `"id"` that resolved to
       * `r.id` inside the subquery: `r.bot_request_id = r.id`, never true.
       * This flag was silently always false. The same mistake was in Module 1's
       * duplicate-patient query, and one test caught both.
       */
      alreadyAsked: sql<boolean>`EXISTS (
        SELECT 1 FROM bot.donor_requests r
         WHERE r.bot_request_id = bot.bot_requests.id AND r.donor_id = ${donorId}
      )`,
    })
    .from(botRequests)
    .where(
      and(
        eq(botRequests.status, 'open'),
        inArray(botRequests.bloodGroup, answerable),
        // Not past the day it was needed. An expired request is closed by the
        // ticker, but a donor should never see one in the window before that.
        sql`${botRequests.neededBy} >= ${today}`,
      ),
    )
    .orderBy(asc(botRequests.neededBy))
    .limit(5);

  const needs: OpenNeed[] = rows.map((row) => ({
    publicId: row.publicId,
    bloodGroup: row.bloodGroup,
    // Units already collected at the counter are not outstanding, whoever
    // gave them (contract 1.2.0).
    unitsOutstanding: Math.max(0, row.unitsNeeded - row.confirmedCount - row.walkInUnits),
    neededBy: row.neededBy,
    hospital: row.hospitalSnapshot as HospitalSnapshot,
    alreadyAsked: row.alreadyAsked,
  }));

  return {
    name: donor.name,
    bloodGroup: donor.bloodGroup as BloodGroup,
    // Reported only when it is the reason they are not being asked.
    eligibleFrom: canGiveToday ? null : donor.nextEligibleOn,
    pausedUntil:
      donor.snoozeUntil !== null && donor.snoozeUntil > today ? donor.snoozeUntil : null,
    qualification: donor.qualificationStatus,
    qualificationReason: donor.qualificationReason,
    needs: needs.filter((need) => need.unitsOutstanding > 0),
  };
}

/**
 * Open requests this donor has not been asked about, for the ticker.
 *
 * Not used by the conversation. It is here so a later phase can offer somebody
 * who came looking a way in, without a wave having reached them. `notExists`
 * rather than a left join, so the shape matches §7.7's own predicate.
 */
export async function unaskedRequestsFor(
  ctx: BotContext,
  donorId: string,
  bloodGroup: BloodGroup,
  limit = 5,
): Promise<{ id: string; publicId: string }[]> {
  return ctx.db
    .select({ id: botRequests.id, publicId: botRequests.publicId })
    .from(botRequests)
    .where(
      and(
        eq(botRequests.status, 'open'),
        inArray(botRequests.bloodGroup, compatibleRecipientGroupsFor(bloodGroup)),
        notExists(
          ctx.db
            .select({ one: sql`1` })
            .from(donorRequests)
            .where(
              and(
                eq(donorRequests.botRequestId, botRequests.id),
                eq(donorRequests.donorId, donorId),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(botRequests.neededBy))
    .limit(limit);
}
