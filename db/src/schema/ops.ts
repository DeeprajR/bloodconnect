/**
 * What the control panel reads (§11.9, §14, P10).
 *
 * Two tables, and both exist because of a boundary rather than in spite of it.
 *
 * `app_web` holds no grant on the `bot` schema at all (migration 0001-bot), so
 * the administration application cannot see the bot's outbox, its jobs or its
 * event log. That is §5.1 working, not a gap: the bot's half holds donor names
 * and phone numbers, and a panel that could read them would be a second copy of
 * the donor register behind an admin login.
 *
 * So the bot **publishes** its own health into `process_health`, in the same
 * way it publishes its recruitment progress onto `donor_demand`. Counts, ages
 * and versions cross the boundary; nothing that names a person does.
 */

import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { hospitalSchema } from './platform.js';

export const HEALTH_STATUSES = ['ok', 'degraded', 'down'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

/** The two deployables of §1. Each writes its own row and reads both. */
export const PROCESSES = ['web', 'bot'] as const;
export type ProcessName = (typeof PROCESSES)[number];

/**
 * One row per process, rewritten on each pass.
 *
 * Not append-only, because this is a heartbeat rather than a record: what
 * matters is the latest observation and how old it is. The history that does
 * matter is already in `audit_log` and the bot's event log.
 *
 * **`observed_at` is the liveness signal.** A process that has stopped stops
 * updating its row, and a stale row is the only way the panel can tell "the bot
 * says everything is fine" from "the bot has not said anything since Tuesday".
 * A status column alone cannot distinguish those, which is exactly the failure
 * §11.9 calls silent.
 */
export const processHealth = hospitalSchema.table(
  'process_health',
  {
    process: text('process').primaryKey(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status').notNull(),
    /** Asserted against the compiled constant at boot (§6). */
    contractVersion: text('contract_version').notNull(),
    /** Whatever identifies the running build. A commit, a tag, or null. */
    buildId: text('build_id'),
    /**
     * The process's own alert counts, as `{ kind, count, oldestAgeSeconds }`.
     *
     * Counts and ages only. §11.9 forbids a name, a phone number or a health
     * datum here, and this column crosses from the bot's half into a screen an
     * administrator reads, which is the one place that rule must not slip.
     */
    alerts: jsonb('alerts').notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    check('process_health_process_check', sql`process IN ('web', 'bot')`),
    check('process_health_status_check', sql`status IN ('ok', 'degraded', 'down')`),
  ],
);

/**
 * One row per served request, kept for a rolling window (§11.9).
 *
 * Per-request rows rather than pre-aggregated counters, because §11.9 asks for
 * p50 and p95 and a counter cannot produce a percentile. At this deployment's
 * volume the rows are cheap, and the window is pruned rather than kept: a
 * time-series store is out of scope, and "is it broken now" needs a day, not a
 * year.
 *
 * **`route` is the pattern, never the path.** `/centre/requests/[id]`, not the
 * request's uuid. Aggregation wants the pattern anyway, and storing the path
 * would put record identifiers into a table nobody thinks of as clinical.
 */
export const requestSamples = hospitalSchema.table(
  'request_samples',
  {
    id: uuid('id').primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    /** Which application, so "the API is slow" and "one app is slow" differ. */
    surface: text('surface').notNull(),
    route: text('route').notNull(),
    method: text('method').notNull(),
    status: integer('status').notNull(),
    durationMs: integer('duration_ms').notNull(),
    /** §14's thread, so a slow request can be followed into the trace screen. */
    correlationId: text('correlation_id'),
  },
  (table) => [
    // The panel's only query shape: a window, grouped by surface and route.
    index('request_samples_window_idx').on(table.occurredAt.desc(), table.surface),
    index('request_samples_correlation_idx').on(table.correlationId),
    check('request_samples_status_check', sql`status >= 100 AND status < 600`),
    check('request_samples_duration_check', sql`duration_ms >= 0`),
  ],
);
