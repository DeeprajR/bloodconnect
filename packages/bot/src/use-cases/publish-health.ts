/**
 * The bot telling the other half of the system how it is (§11.9, P10).
 *
 * The control panel lives in the administration application, on `app_web`,
 * which holds no grant on the `bot` schema at all. That is deliberate: this
 * schema holds donor names and phone numbers, and a panel that could read it
 * would be a second copy of the donor register behind an admin login.
 *
 * So the bot publishes instead, onto `hospital.process_health`, in the same way
 * it already publishes recruitment progress onto `donor_demand`. What crosses
 * is counts, ages and a version string. Nothing that names anybody does, and
 * the `Alert` type has no field that could carry one.
 *
 * Written at the end of every ticker pass, so `observed_at` doubles as the
 * liveness signal: a bot that has stopped stops updating the row, and a stale
 * row is the only way the panel can tell a healthy bot from an absent one.
 */

import { and, count, eq, inArray, isNotNull, lt, min, sql } from 'drizzle-orm';
import { CONTRACT_VERSION } from '@blood-connect/contract';
import { processHealth } from '@blood-connect/db';
import { botJobs, botRequests, messageOutbox } from '@blood-connect/db/bot';
import type { Alert, AlertLevel } from '@blood-connect/domain';

import type { BotContext } from '../context.js';

const ageSeconds = (from: Date | null, now: Date): number | null =>
  from === null ? null : Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));

/**
 * The four §11.9 alerts that only this process can see.
 *
 * `sample` is deliberately empty on every one of them. The ids available here
 * are donor ids and journey ids, which the administration application cannot
 * resolve to anything and has no business holding. A count and an age are what
 * an operator needs: whether to go and look, and how urgently.
 */
export async function botAlerts(ctx: BotContext): Promise<readonly Alert[]> {
  const now = ctx.clock.now();

  // Five minutes, as §7.6 specifies. Unlike the email outbox this drain runs on
  // the ticker, so a pending row older than a few passes is genuinely stuck.
  const stuckBefore = new Date(now.getTime() - 5 * 60 * 1000);

  const [backlog] = await ctx.db
    .select({ n: count(), oldest: min(messageOutbox.createdAt) })
    .from(messageOutbox)
    .where(and(eq(messageOutbox.status, 'pending'), lt(messageOutbox.createdAt, stuckBefore)));

  const [abandoned] = await ctx.db
    .select({ n: count(), oldest: min(messageOutbox.updatedAt) })
    .from(messageOutbox)
    .where(inArray(messageOutbox.status, ['failed', 'abandoned']));

  /*
   * A wave whose turn came and went.
   *
   * `next_wave_at` in the past on a live journey means the ticker did not run,
   * or ran and threw. Either way nobody was invited to give blood for a request
   * that is still open, and nothing else in the system would say so.
   */
  const [waves] = await ctx.db
    .select({ n: count(), oldest: min(botRequests.nextWaveAt) })
    .from(botRequests)
    .where(
      and(
        eq(botRequests.status, 'open'),
        isNotNull(botRequests.nextWaveAt),
        lt(botRequests.nextWaveAt, new Date(now.getTime() - 2 * 60 * 1000)),
      ),
    );

  const [failedJobs] = await ctx.db
    .select({ n: count(), oldest: min(botJobs.updatedAt) })
    .from(botJobs)
    .where(eq(botJobs.status, 'failed'));

  const alert = (
    kind: string,
    level: AlertLevel,
    title: string,
    whatToDo: string,
    row: { n: number | string; oldest: Date | null } | undefined,
  ): Alert => ({
    kind,
    level,
    title,
    whatToDo,
    count: Number(row?.n ?? 0),
    oldestAgeSeconds: ageSeconds(row?.oldest ?? null, now),
    sample: [],
  });

  return [
    alert(
      'bot.outbox_backlog',
      'critical',
      'Messages queued to donors and not sent',
      'Check the chat tile. A stand-down sitting here means somebody is still holding a card for a request that no longer needs them.',
      backlog,
    ),
    alert(
      'bot.outbox_abandoned',
      'critical',
      'Messages the chat platform refused',
      'Read the last error on the bot host. A donor was told nothing, and §7.6 says a closure without its stand-downs is the failure this system must not have.',
      abandoned,
    ),
    alert(
      'bot.wave_overdue',
      'critical',
      'Waves whose turn passed without firing',
      'The ticker is not running, or it is throwing. Nobody is being invited for these requests.',
      waves,
    ),
    alert(
      'bot.jobs_failed',
      'warning',
      'Background jobs that gave up',
      'Read the last error on the bot host. These do not retry again on their own.',
      failedJobs,
    ),
  ];
}

/**
 * Write the heartbeat.
 *
 * One row, rewritten. `ON CONFLICT DO UPDATE` rather than a read followed by a
 * write, so two ticker passes overlapping cannot leave the row missing or
 * duplicated, and so the first pass after a deployment does not need to know
 * whether the row already exists.
 */
export async function publishBotHealth(ctx: BotContext): Promise<readonly Alert[]> {
  const now = ctx.clock.now();
  const alerts = await botAlerts(ctx);

  const worst = alerts.some((a) => a.count > 0 && a.level === 'critical')
    ? 'degraded'
    : 'ok';

  await ctx.db
    .insert(processHealth)
    .values({
      process: 'bot',
      observedAt: now,
      status: worst,
      contractVersion: CONTRACT_VERSION,
      buildId: process.env['BUILD_ID'] ?? null,
      alerts,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: processHealth.process,
      set: {
        observedAt: now,
        status: worst,
        contractVersion: CONTRACT_VERSION,
        buildId: sql`excluded.build_id`,
        alerts: sql`excluded.alerts`,
        updatedAt: now,
      },
    });

  return alerts;
}
