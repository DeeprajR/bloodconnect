/**
 * What the platform knows is going wrong (§11.9).
 *
 * The email outbox, and nothing else: those are the platform's tables. The
 * control panel asks each module for its own alerts rather than querying across
 * modules itself, which is §11.2's rule applied to an operations screen. A
 * panel that read every table directly would be the one place in the system
 * where the boundary did not hold, and it would be the place holding the widest
 * read of all.
 */

import { and, count, eq, inArray, lt, min, sql } from 'drizzle-orm';
import { emailDeliveries } from '@blood-connect/db';
import type { Alert } from '@blood-connect/domain';

import type { UseCaseContext } from '../context.js';

const ageSeconds = (from: Date | null, now: Date): number | null =>
  from === null ? null : Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));

export async function platformAlerts(ctx: UseCaseContext): Promise<readonly Alert[]> {
  const now = ctx.clock.now();

  /*
   * Fifteen minutes, not five. The drain runs after a response rather than on a
   * schedule, so a quiet hour leaves a genuinely queued row sitting for a while
   * with nothing wrong. Alerting at five minutes would teach an operator to
   * ignore this row, which is worse than not having it.
   */
  const stuckBefore = new Date(now.getTime() - 15 * 60 * 1000);

  const [stuck] = await ctx.db
    .select({
      n: count(),
      oldest: min(emailDeliveries.createdAt),
    })
    .from(emailDeliveries)
    .where(
      and(eq(emailDeliveries.status, 'queued'), lt(emailDeliveries.createdAt, stuckBefore)),
    );

  const stuckIds = await ctx.db
    .select({ id: emailDeliveries.id })
    .from(emailDeliveries)
    .where(
      and(eq(emailDeliveries.status, 'queued'), lt(emailDeliveries.createdAt, stuckBefore)),
    )
    .limit(5);

  const [rejecting] = await ctx.db
    .select({
      n: count(),
      oldest: min(emailDeliveries.updatedAt),
    })
    .from(emailDeliveries)
    .where(inArray(emailDeliveries.status, ['bounced', 'complained', 'failed']));

  const rejectingIds = await ctx.db
    .select({ id: emailDeliveries.id })
    .from(emailDeliveries)
    .where(inArray(emailDeliveries.status, ['bounced', 'complained', 'failed']))
    .limit(5);

  return [
    {
      kind: 'email.outbox_backlog',
      level: 'critical',
      title: 'Emails queued and not sent',
      // Named plainly, because the three flows this blocks are the three §2.4
      // calls infrastructure: an invite nobody can activate, a reset code
      // nobody receives, and an address change nobody is warned about.
      whatToDo:
        'Check the SMTP tile below. An invite, a reset code or an address-change warning is waiting behind this.',
      count: stuck?.n ?? 0,
      oldestAgeSeconds: ageSeconds(stuck?.oldest ?? null, now),
      sample: stuckIds.map((row) => row.id),
    },
    {
      kind: 'email.rejected',
      level: 'warning',
      title: 'Emails the provider would not deliver',
      whatToDo:
        'Open the account and check the address. A bounce usually means a typo at the point the account was created.',
      count: rejecting?.n ?? 0,
      oldestAgeSeconds: ageSeconds(rejecting?.oldest ?? null, now),
      sample: rejectingIds.map((row) => row.id),
      href: '/doctors',
      app: 'admin',
    },
  ];
}

/**
 * A round trip, not a ping (§11.9).
 *
 * `SELECT 1` on a connection from the same pool the application uses, so the
 * check fails for the same reasons a request would: the pool exhausted, the
 * server gone, the network in between. A TCP probe would stay green through all
 * three.
 */
export async function checkDatabase(ctx: UseCaseContext): Promise<{ ok: boolean; detail: string }> {
  try {
    const rows = await ctx.db.execute(sql`SELECT 1 AS one`);
    const returned = Array.isArray(rows) ? rows.length : 1;
    return returned > 0
      ? { ok: true, detail: 'Round trip returned a row.' }
      : { ok: false, detail: 'The query returned nothing, which should be impossible.' };
  } catch (cause) {
    return { ok: false, detail: messageOf(cause) };
  }
}

export function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
