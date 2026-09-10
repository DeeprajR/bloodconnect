/**
 * Counters and latency per surface, per route, per status class (§11.9).
 *
 * §11.9 asks for these split by route **and** status class, and the reason is
 * in the difference between two sentences an operator might say. "The API is
 * slow" and "one route returns 500 for one role" call for different actions,
 * and a single average hides the second inside the first.
 *
 * Sourced from what a request already has: the route pattern the framework
 * matched, the status it returned, how long it took, and §14's correlation id.
 * No agent, no separate collector, nothing to keep running.
 */

import { gte, lt, sql } from 'drizzle-orm';
import { requestSamples } from '@blood-connect/db';
import type { UseCaseContext } from '@blood-connect/platform';
import { newId } from '@blood-connect/ids';

import { isSurface, type Surface } from './types.js';

/**
 * All a metrics write needs.
 *
 * Narrower than `UseCaseContext` on purpose. Recording a served request wants a
 * connection and a clock; it has no actor, no permission to check and nothing
 * to hash. Taking the full context would have dragged the password hasher into
 * every caller, and one of those callers is Next's instrumentation hook, which
 * is bundled for the Edge runtime where a native module cannot load at all.
 */
export type MetricsContext = {
  readonly db: UseCaseContext['db'];
  readonly clock: UseCaseContext['clock'];
};

export type Sample = {
  readonly surface: Surface;
  /** The matched pattern, never the path. `/centre/requests/[id]`. */
  readonly route: string;
  readonly method: string;
  readonly status: number;
  readonly durationMs: number;
  readonly correlationId?: string | undefined;
};

export type RouteMetric = {
  readonly surface: Surface;
  readonly route: string;
  readonly requests: number;
  readonly errors: number;
  readonly errorRate: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
};

export type SurfaceMetric = {
  readonly surface: Surface;
  readonly requests: number;
  readonly errors: number;
  readonly errorRate: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
};

/**
 * Record one served request.
 *
 * Called after the response has gone, never in front of it. A metrics write
 * that a user waits for is a metrics system that makes the thing it measures
 * slower, and one that can fail the request it is measuring is worse than none.
 * Failures here are swallowed for the same reason.
 */
export async function recordSample(ctx: MetricsContext, sample: Sample): Promise<void> {
  try {
    await ctx.db.insert(requestSamples).values({
      id: newId(),
      occurredAt: ctx.clock.now(),
      surface: sample.surface,
      route: sample.route,
      method: sample.method,
      status: sample.status,
      durationMs: Math.max(0, Math.round(sample.durationMs)),
      correlationId: sample.correlationId ?? null,
    });
  } catch {
    // Deliberately silent. This is telemetry about a request that has already
    // been answered; nothing here is worth a log line that itself might fail.
  }
}

const windowStart = (ctx: MetricsContext, hours: number): Date =>
  new Date(ctx.clock.now().getTime() - hours * 3_600_000);

/**
 * Percentiles from the rows themselves, not from a counter.
 *
 * `percentile_disc` over the window, which is why this table keeps one row per
 * request. An average would be cheaper and would answer the wrong question: the
 * p95 is where the person waiting actually lives.
 */
export async function routeMetrics(
  ctx: UseCaseContext,
  options: { hours?: number; limit?: number } = {},
): Promise<readonly RouteMetric[]> {
  const hours = options.hours ?? 24;
  const limit = options.limit ?? 25;

  const rows = await ctx.db
    .select({
      surface: requestSamples.surface,
      route: requestSamples.route,
      requests: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) FILTER (WHERE ${requestSamples.status} >= 500)::int`,
      p50Ms: sql<number>`coalesce(percentile_disc(0.5) WITHIN GROUP (ORDER BY ${requestSamples.durationMs}), 0)::int`,
      p95Ms: sql<number>`coalesce(percentile_disc(0.95) WITHIN GROUP (ORDER BY ${requestSamples.durationMs}), 0)::int`,
      maxMs: sql<number>`coalesce(max(${requestSamples.durationMs}), 0)::int`,
    })
    .from(requestSamples)
    .where(gte(requestSamples.occurredAt, windowStart(ctx, hours)))
    .groupBy(requestSamples.surface, requestSamples.route)
    // Busiest first: a route serving three requests a day has a p95 that means
    // nothing, and putting it above one serving three thousand misleads.
    .orderBy(sql`count(*) DESC`)
    .limit(limit);

  return rows.filter((row) => isSurface(row.surface)).map((row) => ({
    surface: row.surface as Surface,
    route: row.route,
    requests: row.requests,
    errors: row.errors,
    errorRate: row.requests === 0 ? 0 : row.errors / row.requests,
    p50Ms: row.p50Ms,
    p95Ms: row.p95Ms,
    maxMs: row.maxMs,
  }));
}

export async function surfaceMetrics(
  ctx: UseCaseContext,
  options: { hours?: number } = {},
): Promise<readonly SurfaceMetric[]> {
  const hours = options.hours ?? 24;

  const rows = await ctx.db
    .select({
      surface: requestSamples.surface,
      requests: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) FILTER (WHERE ${requestSamples.status} >= 500)::int`,
      p50Ms: sql<number>`coalesce(percentile_disc(0.5) WITHIN GROUP (ORDER BY ${requestSamples.durationMs}), 0)::int`,
      p95Ms: sql<number>`coalesce(percentile_disc(0.95) WITHIN GROUP (ORDER BY ${requestSamples.durationMs}), 0)::int`,
    })
    .from(requestSamples)
    .where(gte(requestSamples.occurredAt, windowStart(ctx, hours)))
    .groupBy(requestSamples.surface)
    .orderBy(sql`count(*) DESC`);

  return rows.filter((row) => isSurface(row.surface)).map((row) => ({
    surface: row.surface as Surface,
    requests: row.requests,
    errors: row.errors,
    errorRate: row.requests === 0 ? 0 : row.errors / row.requests,
    p50Ms: row.p50Ms,
    p95Ms: row.p95Ms,
  }));
}

/** Status classes, so "one route 500s" is visible next to "the API is slow". */
export async function statusBreakdown(
  ctx: UseCaseContext,
  options: { hours?: number } = {},
): Promise<readonly { statusClass: string; count: number }[]> {
  const hours = options.hours ?? 24;

  const rows = await ctx.db
    .select({
      statusClass: sql<string>`(${requestSamples.status} / 100)::text || 'xx'`,
      count: sql<number>`count(*)::int`,
    })
    .from(requestSamples)
    .where(gte(requestSamples.occurredAt, windowStart(ctx, hours)))
    .groupBy(sql`(${requestSamples.status} / 100)`)
    .orderBy(sql`(${requestSamples.status} / 100)`);

  return rows;
}

/**
 * Drop what has fallen out of the window.
 *
 * A rolling window in the database is enough to answer "is it broken now", and
 * anything longer wants a time-series store this deployment does not have. So
 * the table is pruned rather than grown, and the pruning lives beside the
 * writing so neither can be deployed without the other.
 */
export async function pruneSamples(
  ctx: MetricsContext,
  options: { keepHours?: number } = {},
): Promise<number> {
  const keepHours = options.keepHours ?? 48;

  // `lt()`, not a raw fragment. The driver cannot bind a JavaScript Date into
  // raw sql and throws before Postgres sees the query, which has now cost time
  // five separate times in this repository.
  const deleted = await ctx.db
    .delete(requestSamples)
    .where(lt(requestSamples.occurredAt, windowStart(ctx, keepHours)))
    .returning({ id: requestSamples.id });

  return deleted.length;
}
