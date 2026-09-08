/**
 * Units the counter collected from people who were never in the bot (§4).
 *
 * The centre records a **walk-in** in `hospital.walk_in_donations`, a table it
 * owns and the bot may only read (contract 1.2.0). The bot has to look, because
 * a unit already in the fridge is a unit it must stop recruiting for: a demand
 * for three units with two walk-ins against it should be calling one donor, not
 * three, and the people it would otherwise call are real ones who would travel
 * to a counter that does not need them.
 *
 * The sync is a plain read and an idempotent write of the count, so a crash
 * mid-pass loses nothing and a repeated pass changes nothing.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { botRequests } from '@blood-connect/db/bot';
import { walkInDonations } from '@blood-connect/db';

import type { BotContext } from '../context.js';
import { createEventWriter } from '../events.js';

export type WalkInSyncResult = {
  /** Requests whose count moved. */
  readonly updated: number;
  /** Requests now covered, counting walk-ins — no longer recruiting. */
  readonly fulfilled: number;
  /** The requests touched, for the caller's write-back set. */
  readonly touched: readonly string[];
};

/**
 * Brings each live request's walk-in count up to date.
 *
 * Only open and fulfilled requests are looked at: a closed demand's count is
 * history, and rewriting it would say the bot did something it did not.
 */
export async function applyWalkIns(ctx: BotContext): Promise<WalkInSyncResult> {
  const live = await ctx.db
    .select({
      id: botRequests.id,
      demandId: botRequests.demandId,
      unitsNeeded: botRequests.unitsNeeded,
      confirmedCount: botRequests.confirmedCount,
      walkInUnits: botRequests.walkInUnits,
      status: botRequests.status,
    })
    .from(botRequests)
    .where(inArray(botRequests.status, ['open', 'fulfilled']));

  if (live.length === 0) return { updated: 0, fulfilled: 0, touched: [] };

  const counts = await ctx.db
    .select({
      demandId: walkInDonations.demandId,
      units: sql<number>`count(*)::int`,
    })
    .from(walkInDonations)
    .where(
      inArray(
        walkInDonations.demandId,
        live.map((row) => row.demandId),
      ),
    )
    .groupBy(walkInDonations.demandId);

  const byDemand = new Map(counts.map((row) => [row.demandId, row.units]));

  const touched: string[] = [];
  let updated = 0;
  let fulfilled = 0;

  for (const request of live) {
    const units = byDemand.get(request.demandId) ?? 0;
    if (units === request.walkInUnits) continue;

    const now = ctx.clock.now();

    const changed = await ctx.db.transaction(async (tx) => {
      /**
       * Guarded on the count this pass read (§7.4).
       *
       * Two tickers running at once must not both report the same walk-in as
       * news, and the guard makes the second one a no-op rather than a
       * duplicate event.
       */
      const moved = await tx
        .update(botRequests)
        .set({ walkInUnits: units })
        .where(
          and(
            eq(botRequests.id, request.id),
            eq(botRequests.walkInUnits, request.walkInUnits),
          ),
        )
        .returning({ id: botRequests.id });

      if (moved.length === 0) return false;

      const event = createEventWriter(tx, ctx.correlationId, now);
      await event({
        event: 'demand.walk_ins_counted',
        subjectType: 'bot_request',
        subjectId: request.id,
        // Counts only. Who walked in is the centre's record, not the bot's
        // (§11.9).
        metadata: {
          walkInUnits: units,
          previously: request.walkInUnits,
          unitsNeeded: request.unitsNeeded,
          confirmed: request.confirmedCount,
        },
      });

      /**
       * Stop recruiting once the need is covered.
       *
       * The same edge `acceptRequest` owns, reached a different way: there, a
       * donor filled the last place; here, somebody already had. Donors who
       * confirmed are **not** stood down — they committed, they are expected,
       * and turning them away after they said yes is its own harm. What stops
       * is new invitations and waitlist promotion.
       */
      if (request.confirmedCount + units >= request.unitsNeeded) {
        const closedToWaves = await tx
          .update(botRequests)
          .set({ status: 'fulfilled', nextWaveAt: null })
          .where(and(eq(botRequests.id, request.id), eq(botRequests.status, 'open')))
          .returning({ id: botRequests.id });

        if (closedToWaves.length > 0) {
          await event({
            event: 'demand.fulfilled',
            subjectType: 'bot_request',
            subjectId: request.id,
            metadata: { by: 'walk_in', walkInUnits: units },
          });
          return 'fulfilled';
        }
      }

      return true;
    });

    if (changed === false) continue;
    updated += 1;
    if (changed === 'fulfilled') fulfilled += 1;
    touched.push(request.id);
  }

  return { updated, fulfilled, touched };
}
