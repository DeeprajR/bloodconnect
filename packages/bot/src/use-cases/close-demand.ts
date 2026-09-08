/**
 * Closing a demand, and standing every donor down (§7.6).
 *
 * This is the most consequential transaction in the bot, and §14 names it as the
 * one most likely to be left half-built: the happy path is visible in a demo and
 * this is not, until the day somebody travels to a hospital for a request that
 * ended yesterday.
 *
 * A demand closes exactly one way of four — completed, cancelled, expired, or
 * fulfilled then completed — and whichever it is, the closure must stop
 * recruitment **and** fan out the stand-downs in the same pass.
 *
 * ```
 * BEGIN;
 *   UPDATE bot_requests   ... WHERE status IN ('open','fulfilled')  -- idempotent close
 *   UPDATE donor_requests ... WHERE status IN (the five live ones)  -- stop the journeys
 *   INSERT message_outbox SELECT ... one row per donor still waiting
 * COMMIT;
 * -- a separate drain sends them, with retries; dedupe_key makes replay harmless
 * ```
 *
 * The messages are **not** sent in this transaction. A chat API timeout after
 * the commit would lose them silently, and the demand would show closed with
 * nobody told — precisely the failure the outbox exists to prevent.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { botRequests, donorChannels, donorRequests } from '@blood-connect/db/bot';
import { donorDemand } from '@blood-connect/db';
import { STANDS_DOWN_ON_CLOSURE } from '@blood-connect/domain';
import { err, ok, type Result } from '@blood-connect/result';

import type { BotContext } from '../context.js';
import { createEventWriter } from '../events.js';
import { MESSAGES } from '../messages.js';
import { enqueue, type QueuedMessage } from '../outbox.js';

export type ClosureReason = 'completed' | 'cancelled' | 'expired';

export type CloseResult = {
  readonly closed: boolean;
  readonly standDowns: number;
  readonly journeysEnded: number;
};

export type CloseError =
  | { readonly kind: 'RequestNotFound'; readonly message: string }
  | { readonly kind: 'AlreadyClosed'; readonly message: string };

/**
 * Closes one request and stands down everyone still holding a place.
 *
 * Idempotent: the conditional UPDATE matches only an open or fulfilled request,
 * so a second call closes nothing and queues nothing. Calling it twice is
 * expected — the ticker and a centre cancellation can arrive together.
 */
export async function closeDemand(
  ctx: BotContext,
  botRequestId: string,
  reason: ClosureReason,
): Promise<Result<CloseResult, CloseError>> {
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(botRequests)
      .where(eq(botRequests.id, botRequestId));

    if (!request) {
      return err({ kind: 'RequestNotFound' as const, message: 'No such request.' });
    }

    /* --- 1. close it, guarded on the statuses it may close from ---------- */
    const closed = await tx
      .update(botRequests)
      .set({
        status: reason === 'completed' ? 'completed' : reason,
        closedAt: now,
        closureReason: reason,
        // Stops recruitment. A closed request with a wave still scheduled would
        // message people about a request that has ended.
        nextWaveAt: null,
      })
      .where(
        and(
          eq(botRequests.id, botRequestId),
          inArray(botRequests.status, ['open', 'fulfilled']),
        ),
      )
      .returning({ id: botRequests.id });

    if (closed.length === 0) {
      return ok({ closed: false, standDowns: 0, journeysEnded: 0 });
    }

    /* --- 2. everyone who was told something and is still waiting --------- */
    // The five live states of §7.6. Someone already DECLINED or DEFERRED is not
    // waiting for anything and must not be messaged again.
    const waiting = await tx
      .select({
        journeyId: donorRequests.id,
        donorId: donorRequests.donorId,
        channel: donorChannels.channel,
        channelUserId: donorChannels.channelUserId,
      })
      .from(donorRequests)
      .innerJoin(donorChannels, eq(donorChannels.donorId, donorRequests.donorId))
      .where(
        and(
          eq(donorRequests.botRequestId, botRequestId),
          inArray(donorRequests.status, [...STANDS_DOWN_ON_CLOSURE]),
        ),
      );

    const ended = await tx
      .update(donorRequests)
      .set({ status: 'CANCELLED', terminalAt: now })
      .where(
        and(
          eq(donorRequests.botRequestId, botRequestId),
          inArray(donorRequests.status, [...STANDS_DOWN_ON_CLOSURE]),
        ),
      )
      .returning({ id: donorRequests.id });

    /* --- 3. one stand-down per donor, committed with the closure --------- */
    const messages: QueuedMessage[] = waiting.map((donor) => ({
      to: { channel: donor.channel, channelUserId: donor.channelUserId },
      kind: 'stand_down' as const,
      message: { text: MESSAGES.standDown(reason) },
      // Built from the ids involved, never a timestamp: a replayed closure must
      // write nothing rather than a second copy.
      dedupeKey: `stand_down:${botRequestId}:${donor.donorId}`,
    }));

    const queued = await enqueue(tx, ctx.ids, messages, now);

    const event = createEventWriter(tx, ctx.correlationId, now);
    await event({
      event: 'demand.closed',
      subjectType: 'bot_request',
      subjectId: botRequestId,
      metadata: {
        reason,
        journeysEnded: ended.length,
        standDownsQueued: queued,
        // The count, and the donor ids — never a name or a number (§11.9).
        donorIds: waiting.map((donor) => donor.donorId),
      },
    });

    /* --- 4. tell the centre, on the one column the bot may move ---------- */
    // `open -> expired` and `fulfilled -> completed` are the bot's edges in
    // `packages/contract`. A cancellation came *from* the centre, so the bot
    // does not write that status back — it is already there.
    if (reason !== 'cancelled') {
      await tx
        .update(donorDemand)
        .set({ status: reason === 'completed' ? 'completed' : 'expired' })
        .where(
          and(
            eq(donorDemand.id, request.demandId),
            inArray(donorDemand.status, ['open', 'fulfilled']),
          ),
        );
    }

    return ok({ closed: true, standDowns: queued, journeysEnded: ended.length });
  });
}

/**
 * Demands the centre has withdrawn, which the bot has not closed yet.
 *
 * The centre sets `cancelled` and stops (§8.3) — it cannot send a stand-down,
 * because the donors are the bot's and it knows nothing about the channel. This
 * poll is the other half of that handover, and it is why a cancellation on the
 * centre's screen reaches a donor at all.
 */
export async function findCancelledDemands(
  ctx: BotContext,
  limit = 20,
): Promise<{ botRequestId: string; demandId: string }[]> {
  return ctx.db
    .select({ botRequestId: botRequests.id, demandId: botRequests.demandId })
    .from(botRequests)
    .innerJoin(donorDemand, eq(donorDemand.id, botRequests.demandId))
    .where(
      and(
        eq(donorDemand.status, 'cancelled'),
        inArray(botRequests.status, ['open', 'fulfilled']),
      ),
    )
    .limit(limit);
}

/**
 * Requests whose day has passed (§8).
 *
 * A demand that quietly stays open past the day the blood was needed is a flow
 * with no ending, which §8 exists to prevent — and the donors holding places for
 * it are never told.
 */
export async function findExpiredDemands(
  ctx: BotContext,
  limit = 20,
): Promise<{ botRequestId: string }[]> {
  const today = ctx.clock.today();

  return ctx.db
    .select({ botRequestId: botRequests.id })
    .from(botRequests)
    .where(
      and(
        inArray(botRequests.status, ['open', 'fulfilled']),
        sql`${botRequests.neededBy} < ${today}`,
      ),
    )
    .limit(limit);
}
