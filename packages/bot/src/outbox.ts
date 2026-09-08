/**
 * The message outbox (§7.6).
 *
 * §5 names "a demand closed without its stand-down messages sent" as the failure
 * this system must not have. So a closure does not call a chat API: it inserts
 * rows here, in the same transaction that closes the demand, and a separate
 * drain sends them.
 *
 * That indirection is the whole guarantee. Sending inside the closing
 * transaction would mean a chat API timeout *after* the commit loses the
 * messages silently — the demand shows closed, the donors are still expecting
 * to give blood, and nothing anywhere records that they were never told.
 *
 * `dedupe_key` makes redelivery harmless, so the drain can be at-least-once,
 * which is the only delivery guarantee a network actually offers.
 */

import { and, eq, lte, sql } from 'drizzle-orm';
import { messageOutbox } from '@blood-connect/db/bot';

import type { IdGenerator } from '@blood-connect/ids';

import type { BotContext } from './context.js';
import type { BotTransaction } from './db.js';
import type { ChannelAddress, OutgoingMessage } from './ports/channel.js';

/** Kinds, so the §11.9 alert can ask specifically about stand-downs. */
export const MESSAGE_KINDS = [
  'request_card',
  'confirmed',
  'waitlisted',
  'promoted',
  'deferred',
  'declined',
  'stand_down',
  'thanks',
  'no_show',
  'reply',
] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export type QueuedMessage = {
  readonly to: ChannelAddress;
  readonly kind: MessageKind;
  readonly message: OutgoingMessage;
  /**
   * One message per reason per recipient. Built from the ids involved, never
   * from a timestamp — a key with a clock in it deduplicates nothing.
   */
  readonly dedupeKey: string;
};

/**
 * Queues messages on a transaction the caller already owns.
 *
 * Takes a `BotTransaction` rather than a context for the reason the whole
 * pattern exists: the rows must commit with the state change that caused them.
 * `now` comes from the caller's injected clock for the same reason the drain
 * reads one — see the note on `nextAttemptAt` below.
 */
export async function enqueue(
  tx: BotTransaction,
  ids: IdGenerator,
  messages: readonly QueuedMessage[],
  now: Date,
): Promise<number> {
  if (messages.length === 0) return 0;

  const rows = await tx
    .insert(messageOutbox)
    .values(
      messages.map((message) => ({
        id: ids.next<'OutboxId'>(),
        channel: message.to.channel,
        channelUserId: message.to.channelUserId,
        kind: message.kind,
        payload: message.message,
        status: 'pending' as const,
        /**
         * From the injected clock, never the database's `now()`.
         *
         * The drain decides what is due using `ctx.clock`, so a row stamped by
         * the database is a row compared against a different clock — and under
         * a frozen clock nothing is ever due, which is a queue that silently
         * stops. §3 injects time precisely so the two cannot drift apart.
         */
        nextAttemptAt: now,
        // Stamped from the same clock, for the same reason: the §11.9 alert
        // asks "queued more than five minutes ago and still not sent", and a
        // database-stamped `created_at` compared against the injected clock
        // answers a question about two different timelines.
        createdAt: now,
        dedupeKey: message.dedupeKey,
      })),
    )
    // A replay writes nothing. The unique index on `dedupe_key` is what makes
    // the drain safe to run twice and the closure safe to retry.
    .onConflictDoNothing()
    .returning({ id: messageOutbox.id });

  return rows.length;
}

export type DrainResult = {
  readonly sent: number;
  readonly failed: number;
  readonly abandoned: number;
};

/** Stops retrying after this many attempts, and says so in the row. */
export const MAX_ATTEMPTS = 6;

/** How long a claimed message is held before another drain may retry it. */
const LEASE_MS = 60_000;

/** Exponential, capped: 1, 2, 4, 8, 16, 30 minutes. */
const backoffMinutes = (attempts: number): number => Math.min(30, 2 ** attempts);

/**
 * Sends what is due, one message at a time.
 *
 * Claims each row with a conditional UPDATE before sending, so two drains
 * running at once do not both send the same message. The send happens **outside**
 * any transaction — holding one open across a network call is how a connection
 * pool is exhausted by a slow chat API.
 */
export async function drainOutbox(
  ctx: BotContext,
  limit = 50,
): Promise<DrainResult> {
  const now = ctx.clock.now();
  let sent = 0;
  let failed = 0;
  let abandoned = 0;

  const due = await ctx.db
    .select({
      id: messageOutbox.id,
      channel: messageOutbox.channel,
      channelUserId: messageOutbox.channelUserId,
      kind: messageOutbox.kind,
      payload: messageOutbox.payload,
      attempts: messageOutbox.attempts,
    })
    .from(messageOutbox)
    .where(and(eq(messageOutbox.status, 'pending'), lte(messageOutbox.nextAttemptAt, now)))
    .orderBy(messageOutbox.createdAt)
    .limit(limit);

  for (const row of due) {
    /**
     * Claim it by taking a lease: bump the attempt count and push
     * `next_attempt_at` forward, guarded on the row still being due.
     *
     * A lease rather than a `sending` status, because a status would need a
     * crash-recovery sweep to release rows the process died holding. A lease
     * releases itself — the worst case is one message sent twice after a crash,
     * and `dedupe_key` is why that is harmless.
     */
    const claimed = await ctx.db
      .update(messageOutbox)
      .set({
        attempts: sql`${messageOutbox.attempts} + 1`,
        nextAttemptAt: new Date(now.getTime() + LEASE_MS),
      })
      .where(
        and(
          eq(messageOutbox.id, row.id),
          eq(messageOutbox.status, 'pending'),
          lte(messageOutbox.nextAttemptAt, now),
        ),
      )
      .returning({ attempts: messageOutbox.attempts });

    // Another drain got there first.
    if (claimed.length === 0) continue;

    const result = await ctx.channel.send(
      { channel: row.channel, channelUserId: row.channelUserId },
      row.payload as OutgoingMessage,
    );

    if (result.ok) {
      await ctx.db
        .update(messageOutbox)
        .set({ status: 'sent', sentAt: ctx.clock.now(), lastError: null })
        .where(eq(messageOutbox.id, row.id));
      sent += 1;
      continue;
    }

    const attempts = claimed[0]?.attempts ?? row.attempts + 1;
    // A permanent failure is somebody who has blocked the bot. Retrying that
    // forever fills the queue with messages that can never be delivered, and
    // buries the ones that could.
    const giveUp = result.permanent || attempts >= MAX_ATTEMPTS;

    await ctx.db
      .update(messageOutbox)
      .set({
        status: giveUp ? 'abandoned' : 'pending',
        lastError: result.reason.slice(0, 500),
        nextAttemptAt: new Date(
          ctx.clock.now().getTime() + backoffMinutes(attempts) * 60_000,
        ),
      })
      .where(eq(messageOutbox.id, row.id));

    if (giveUp) abandoned += 1;
    else failed += 1;
  }

  return { sent, failed, abandoned };
}

/**
 * The §11.9 alert, as a query.
 *
 * "A demand closed without its stand-down messages sent" is not detectable by
 * looking at demands — they all look closed. It is detectable here: a
 * stand-down still pending five minutes after it was written means somebody is
 * still expecting to give blood for a request that has ended.
 */
export async function countStuckStandDowns(
  ctx: BotContext,
  olderThanMinutes = 5,
): Promise<number> {
  const cutoff = new Date(ctx.clock.now().getTime() - olderThanMinutes * 60_000);

  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(messageOutbox)
    .where(
      and(
        eq(messageOutbox.kind, 'stand_down'),
        sql`${messageOutbox.status} <> 'sent'`,
        lte(messageOutbox.createdAt, cutoff),
      ),
    );

  return row?.n ?? 0;
}
