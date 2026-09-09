/**
 * The one reminder an abandoned signup gets (§5).
 *
 * "Abandons partway → their progress is held. **One gentle reminder, once**;
 * then silence. Nothing is deleted, and returning drops them back on the
 * question they stopped at."
 *
 * All three clauses matter, and the third is why this sends a nudge rather than
 * a fresh welcome: the draft is still there, so coming back means answering the
 * question they were already on.
 *
 * **Once is enforced by the outbox, not by a flag.** `dedupe_key` is uniquely
 * indexed, so a second attempt for the same person inserts nothing whatever the
 * ticker does — the same mechanism that makes a replayed stand-down harmless.
 * A `reminded_at` column would have been a second source of truth for the same
 * fact, and one that a crash between the update and the send could desynchronise.
 */

import { and, eq, gt, lt } from 'drizzle-orm';
import { conversationState } from '@blood-connect/db/bot';

import type { BotContext } from '../context.js';
import { MESSAGES } from '../messages.js';
import { enqueue, type QueuedMessage } from '../outbox.js';

/**
 * How long a draft sits untouched before the nudge.
 *
 * Long enough that somebody who put their phone down mid-question is not
 * chased, short enough that the draft has not expired — `DRAFT_TTL_HOURS` is
 * 48, and a reminder arriving after the answers were dropped would send
 * somebody back to a question they had already answered.
 */
export const REMIND_AFTER_HOURS = 6;

export type ReminderResult = {
  readonly reminded: number;
};

export async function remindAbandonedSignups(
  ctx: BotContext,
  limit = 50,
): Promise<ReminderResult> {
  const now = ctx.clock.now();
  const cutoff = new Date(now.getTime() - REMIND_AFTER_HOURS * 3_600_000);

  const stale = await ctx.db
    .select({
      channel: conversationState.channel,
      channelUserId: conversationState.channelUserId,
      step: conversationState.step,
      updatedAt: conversationState.updatedAt,
    })
    .from(conversationState)
    .where(
      and(
        // Signup only. A donor half-way through editing their profile has
        // nothing to be reminded about — they are already registered.
        eq(conversationState.flow, 'onboarding'),
        lt(conversationState.updatedAt, cutoff),
        /**
         * Still resumable. Past the TTL the draft is gone and a nudge would
         * point at nothing.
         *
         * `gt`, not a raw `sql` template: the driver cannot bind a `Date`
         * interpolated into one, and it fails at the bind rather than at
         * compile time. The same mistake was in `findRequestsDueAWave`.
         */
        gt(conversationState.expiresAt, now),
      ),
    )
    .limit(limit);

  if (stale.length === 0) return { reminded: 0 };

  const messages: QueuedMessage[] = stale.map((row) => ({
    to: { channel: row.channel, channelUserId: row.channelUserId },
    kind: 'signup_reminder' as const,
    message: { text: MESSAGES.signupReminder },
    // Per person, not per draft: somebody who abandons twice is not chased
    // twice, which is what "once, then silence" means.
    dedupeKey: `signup-reminder:${row.channel}:${row.channelUserId}`,
  }));

  const enqueued = await ctx.db.transaction(async (tx) =>
    enqueue(tx, ctx.ids, messages, now),
  );

  return { reminded: enqueued };
}
