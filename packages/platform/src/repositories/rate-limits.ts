/**
 * Login and OTP throttling, in the database (§3, §13).
 *
 * In the database rather than in memory for two reasons the spec states: the
 * limit must survive a restart, and it must apply across replicas. An in-memory
 * counter gives an attacker a fresh allowance every deploy and one allowance per
 * replica, which on three replicas is three times the intended limit.
 *
 * Fixed windows, not a sliding log. A sliding window is more precise and needs a
 * row per attempt; a fixed window needs one row per window and is wrong only at
 * the boundary, where being wrong means allowing at most twice the limit across
 * two adjacent windows. For a login throttle that is an acceptable trade, and it
 * keeps the table small enough that nothing has to prune it aggressively.
 */

import { and, eq, sql } from 'drizzle-orm';
import { authRateLimits, type AuthRateLimitScope } from '@blood-connect/db';

import type { Transaction } from '../db.js';

/** The instant the current fixed window opened. */
export function windowStartFor(now: Date, windowMinutes: number): Date {
  const windowMs = windowMinutes * 60_000;
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

export function secondsUntilWindowEnds(now: Date, windowMinutes: number): number {
  const windowMs = windowMinutes * 60_000;
  const start = windowStartFor(now, windowMinutes).getTime();
  return Math.ceil((start + windowMs - now.getTime()) / 1000);
}

export async function attemptsInWindow(
  tx: Transaction,
  scope: AuthRateLimitScope,
  key: string,
  now: Date,
  windowMinutes: number,
): Promise<number> {
  const [row] = await tx
    .select({ attempts: authRateLimits.attempts })
    .from(authRateLimits)
    .where(
      and(
        eq(authRateLimits.scope, scope),
        eq(authRateLimits.key, key),
        eq(authRateLimits.windowStart, windowStartFor(now, windowMinutes)),
      ),
    );

  return row?.attempts ?? 0;
}

/**
 * One statement, so two simultaneous attempts cannot both read 4 and both write
 * 5. The unique index on `(scope, key, window_start)` is what makes the upsert
 * safe; without it this would be a read-then-write with a race in the middle.
 */
export async function recordFailedAttempt(
  tx: Transaction,
  scope: AuthRateLimitScope,
  key: string,
  now: Date,
  windowMinutes: number,
): Promise<number> {
  const [row] = await tx
    .insert(authRateLimits)
    .values({ scope, key, windowStart: windowStartFor(now, windowMinutes), attempts: 1 })
    .onConflictDoUpdate({
      target: [authRateLimits.scope, authRateLimits.key, authRateLimits.windowStart],
      set: { attempts: sql`${authRateLimits.attempts} + 1` },
    })
    .returning({ attempts: authRateLimits.attempts });

  return row?.attempts ?? 1;
}

/**
 * A successful sign-in clears the account's counter, so someone who mistypes
 * three times and then gets it right is not one slip away from a lockout for
 * the rest of the window. The IP counter is deliberately left alone: on a
 * shared hospital network a successful sign-in by one person must not reset an
 * attacker's budget.
 */
export async function clearAttempts(
  tx: Transaction,
  scope: AuthRateLimitScope,
  key: string,
): Promise<void> {
  await tx
    .delete(authRateLimits)
    .where(and(eq(authRateLimits.scope, scope), eq(authRateLimits.key, key)));
}
