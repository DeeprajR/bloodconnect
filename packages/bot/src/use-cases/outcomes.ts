/**
 * What happened at the counter, coming back to the donor (§8.4, §4).
 *
 * **The centre is the authority on who gave blood.** The bot knows who said
 * yes; only the counter knows who turned up. So the interval is rolled forward
 * from `donor_demand_confirmations.status`, written by the centre, and never
 * from the bot's own view of the journey — getting a donor's interval right
 * matters more than tidy state (§4).
 *
 * `acknowledged_at` is the bot's marker that it has processed a row: the poll
 * looks for confirmations the centre has marked and the bot has not yet acted
 * on, so this is idempotent and a crash mid-batch loses nothing.
 */

import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { botRequests, donorChannels, donorRequests, donors } from '@blood-connect/db/bot';
import { donorDemandConfirmations } from '@blood-connect/db';
import { nextEligibleOn, type CalendarDay, type Sex } from '@blood-connect/domain';

import type { BotContext } from '../context.js';
import { createEventWriter } from '../events.js';
import { MESSAGES } from '../messages.js';
import { enqueue, type QueuedMessage } from '../outbox.js';

export type OutcomeResult = {
  readonly processed: number;
  readonly completed: number;
  readonly noShows: number;
};

/**
 * Applies every counter outcome the bot has not yet acknowledged.
 *
 * One transaction per confirmation rather than one for the batch: a single bad
 * row must not stop the rest of the day's donors being thanked and having their
 * intervals set.
 */
export async function applyCounterOutcomes(
  ctx: BotContext,
  limit = 50,
): Promise<OutcomeResult> {
  const pending = await ctx.db
    .select({
      id: donorDemandConfirmations.id,
      demandId: donorDemandConfirmations.demandId,
      donorId: donorDemandConfirmations.donorId,
      status: donorDemandConfirmations.status,
      donatedAt: donorDemandConfirmations.donatedAt,
      bagIdentifier: donorDemandConfirmations.bagIdentifier,
    })
    .from(donorDemandConfirmations)
    .where(
      and(
        // Marked by the counter, and not yet acted on.
        ne(donorDemandConfirmations.status, 'confirmed'),
        isNull(donorDemandConfirmations.acknowledgedAt),
      ),
    )
    .limit(limit);

  let processed = 0;
  let completed = 0;
  let noShows = 0;

  for (const row of pending) {
    const done = await applyOne(ctx, row);
    if (!done) continue;
    processed += 1;
    if (row.status === 'completed') completed += 1;
    if (row.status === 'no_show') noShows += 1;
  }

  return { processed, completed, noShows };
}

async function applyOne(
  ctx: BotContext,
  row: {
    id: string;
    demandId: string;
    donorId: string;
    status: string;
    donatedAt: string | null;
    bagIdentifier: string | null;
  },
): Promise<boolean> {
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    /**
     * Claim it first, guarded on `acknowledged_at IS NULL` (§7.4).
     *
     * Two workers polling at once would otherwise both roll the interval
     * forward and both thank the donor. The second matches nothing here.
     */
    const claimed = await tx
      .update(donorDemandConfirmations)
      .set({ acknowledgedAt: now })
      .where(
        and(
          eq(donorDemandConfirmations.id, row.id),
          isNull(donorDemandConfirmations.acknowledgedAt),
        ),
      )
      .returning({ id: donorDemandConfirmations.id });

    if (claimed.length === 0) return false;

    const [request] = await tx
      .select()
      .from(botRequests)
      .where(eq(botRequests.demandId, row.demandId));

    const [donor] = await tx
      .select({ id: donors.id, sex: donors.sex, lastDonatedOn: donors.lastDonatedOn })
      .from(donors)
      .where(eq(donors.id, row.donorId));

    const [channel] = await tx
      .select({ channel: donorChannels.channel, channelUserId: donorChannels.channelUserId })
      .from(donorChannels)
      .where(eq(donorChannels.donorId, row.donorId));

    const event = createEventWriter(tx, ctx.correlationId, now);
    const messages: QueuedMessage[] = [];

    if (row.status === 'completed' && donor) {
      /**
       * The interval rolls forward from the donation day, using the domain's
       * rule and the configured figures (§12) — never a constant here. A
       * shortened interval to make something work is the one change in this
       * system that could physically harm someone.
       */
      const donatedOn = (row.donatedAt ?? ctx.clock.today()) as CalendarDay;
      const eligible = nextEligibleOn(
        donatedOn,
        donor.sex as Sex,
        ctx.config.donor.intervalDays,
      );

      await tx
        .update(donors)
        .set({ lastDonatedOn: donatedOn, nextEligibleOn: eligible ?? null })
        .where(eq(donors.id, donor.id));

      if (request) {
        await tx
          .update(donorRequests)
          .set({ status: 'COMPLETED', terminalAt: now })
          .where(
            and(
              eq(donorRequests.botRequestId, request.id),
              eq(donorRequests.donorId, donor.id),
              eq(donorRequests.status, 'CONFIRMED'),
            ),
          );

        await tx
          .update(botRequests)
          .set({ completedCount: sql`${botRequests.completedCount} + 1` })
          .where(eq(botRequests.id, request.id));
      }

      if (channel && eligible) {
        messages.push({
          to: channel,
          kind: 'thanks',
          message: { text: MESSAGES.thanks(eligible) },
          dedupeKey: `thanks:${row.id}`,
        });
      }

      await event({
        event: 'donor.donated',
        subjectType: 'donor',
        subjectId: donor.id,
        // The bag identifier links a donor to a unit, which is the traceability
        // §4 requires. No name, no phone number (§11.9).
        metadata: { demandId: row.demandId, bagIdentifier: row.bagIdentifier, eligible },
      });
    }

    if (row.status === 'no_show' && request) {
      await tx
        .update(donorRequests)
        .set({ status: 'NO_SHOW', terminalAt: now })
        .where(
          and(
            eq(donorRequests.botRequestId, request.id),
            eq(donorRequests.donorId, row.donorId),
            eq(donorRequests.status, 'CONFIRMED'),
          ),
        );

      // The place is free again, so the count comes back down and the waitlist
      // can be promoted into it. Leaving it claimed would quietly under-recruit.
      await tx
        .update(botRequests)
        .set({ confirmedCount: sql`greatest(0, ${botRequests.confirmedCount} - 1)` })
        .where(eq(botRequests.id, request.id));

      if (channel) {
        messages.push({
          to: channel,
          kind: 'no_show',
          message: { text: MESSAGES.noShowNoted },
          dedupeKey: `no_show:${row.id}`,
        });
      }

      await event({
        event: 'donor.no_show',
        subjectType: 'donor',
        subjectId: row.donorId,
        metadata: { demandId: row.demandId },
      });
    }

    if (messages.length > 0) await enqueue(tx, ctx.ids, messages, now);

    return true;
  });
}

/**
 * Requests where every unit has been given (§8).
 *
 * The demand's ending, and the one that closes the loop: enough people came,
 * the patient has what they need, and everybody still holding a place is stood
 * down with the "completed" wording.
 */
export async function findCompletedRequests(
  ctx: BotContext,
  limit = 20,
): Promise<{ botRequestId: string }[]> {
  return ctx.db
    .select({ botRequestId: botRequests.id })
    .from(botRequests)
    .where(
      and(
        eq(botRequests.status, 'fulfilled'),
        sql`${botRequests.completedCount} >= ${botRequests.unitsNeeded}`,
      ),
    )
    .limit(limit);
}
