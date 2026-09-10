import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { CONFIG_DEFAULTS } from '@blood-connect/config';
import { auditLog, donorDemand, processHealth } from '@blood-connect/db';
import { idGenerator, newId } from '@blood-connect/ids';
import { createFakeClock } from '@blood-connect/testing';
import {
  anonymousActor,
  argon2Hasher,
  nodeTokens,
  type Actor,
  type Database,
  type UseCaseContext,
} from '@blood-connect/platform';

import { readBoard } from './board.js';
import { pruneSamples, recordSample, routeMetrics, statusBreakdown, surfaceMetrics } from './metrics.js';
import { trace } from './trace.js';

const testUrl = process.env['TEST_DATABASE_URL'];

const CENTRE_ID = '01930000-0000-7000-8000-000000000001';
const START = '2026-09-10T09:00:00.000Z';

describe.skipIf(!testUrl)('the control panel (§11.9, §14)', () => {
  const client = postgres(testUrl ?? '', { max: 5, onnotice: () => undefined });
  const db = drizzle(client) as unknown as Database;
  const clock = createFakeClock(START);

  let adminId: string;

  // Resolved lazily, because the actor's id is created in `beforeEach` and the
  // audit log has a foreign key to it: a trace read has to be attributable to
  // an account that exists (§14).
  const admin = (): Actor => ({
    kind: 'user',
    userId: adminId,
    role: 'admin',
    districtScopeId: null,
  });

  const context = (actor: Actor = admin()): UseCaseContext => ({
    db,
    clock,
    ids: idGenerator,
    ports: { hasher: argon2Hasher, tokens: nodeTokens },
    actor,
    correlationId: newId(),
    config: CONFIG_DEFAULTS,
  });

  let doctorId: string;
  let requestUuid: string;

  beforeEach(async () => {
    clock.set(new Date(START));

    await client`TRUNCATE hospital.request_samples, hospital.process_health,
                          hospital.donor_demand_confirmations, hospital.donor_demand,
                          hospital.audit_log, hospital.blood_requests, hospital.users
                 RESTART IDENTITY CASCADE`;
    await client`INSERT INTO hospital.centres (id, name)
                 VALUES (${CENTRE_ID}, 'Test centre') ON CONFLICT (id) DO NOTHING`;

    doctorId = newId();
    adminId = newId();
    await client`INSERT INTO hospital.users (id, email, full_name, role, status, password_hash)
                 VALUES (${doctorId}, ${`panel-${doctorId}@blood-connect.invalid`},
                         'Fixture Doctor', 'doctor', 'active', 'x'),
                        (${adminId}, ${`panel-admin-${adminId}@blood-connect.invalid`},
                         'Fixture Admin', 'admin', 'active', 'x')`;

    requestUuid = newId();
    await client`INSERT INTO hospital.blood_requests
                   (id, request_id, centre_id, doctor_id, status, urgency, blood_group,
                    product, units, date_required, submitted_at, doctor_snapshot)
                 VALUES (${requestUuid}, '100926-00042', ${CENTRE_ID}, ${doctorId},
                         'submitted', 'urgent', 'O-', 'whole_blood', 3, '2026-09-11',
                         now(), '{}'::jsonb)`;
  });

  afterAll(async () => {
    await client`DELETE FROM hospital.request_samples`;
    await client`DELETE FROM hospital.process_health`;
    await client.end({ timeout: 5 });
  });

  /* ----------------------------------------------------------------- trace */

  const raiseDemand = async (over: { confirmed?: number; notified?: number } = {}) => {
    const id = newId();
    await db.insert(donorDemand).values({
      id,
      centreId: CENTRE_ID,
      trigger: 'request_shortfall',
      bloodRequestId: requestUuid,
      bloodGroup: 'O-',
      product: 'whole_blood',
      units: 3,
      dateRequired: '2026-09-11',
      hospitalName: 'Test centre',
      hospitalAddress: 'Somewhere',
      districtId: 'TEST_DISTRICT',
      status: 'open',
      donorsNotified: over.notified ?? 4,
      confirmedUnits: over.confirmed ?? 1,
      importedAt: new Date('2026-09-10T08:00:00.000Z'),
      botPublicId: 'BC-TEST-1',
    });
    return id;
  };

  it('follows a request from its number through to the demand', async () => {
    await raiseDemand();

    const result = await trace(context(), '100926-00042');

    expect(result.found).toBe(true);
    const stages = result.steps.map((step) => step.stage);
    expect(stages).toContain('request.raised');
    expect(stages).toContain('demand.raised');
    expect(stages).toContain('demand.progress');
  });

  it('accepts the number however it was transcribed', async () => {
    // Read out at a counter, typed into an incident note, pasted here.
    for (const typed of ['100926-00042', '100926 00042', '10092600042']) {
      const result = await trace(context(), typed);
      expect(result.found, typed).toBe(true);
    }
  });

  it('refuses a number of the wrong length rather than guessing', async () => {
    const result = await trace(context(), '100926-0042');
    expect(result.found).toBe(false);
  });

  it('resolves a demand id back to the request it answers', async () => {
    const demandId = await raiseDemand();
    const result = await trace(context(), demandId);

    expect(result.found).toBe(true);
    expect(result.steps.some((step) => step.stage === 'request.raised')).toBe(true);
  });

  it('audits every trace by record id (§12.2)', async () => {
    await trace(context(), '100926-00042');

    const rows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'ops.trace_read'));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.subjectId).toBe(requestUuid);
    expect(rows[0]?.actorUserId).toBe(adminId);
  });

  it('writes no audit row for a query that matched nothing', async () => {
    // Nothing was read, so nothing is recorded. An audit log padded with
    // failed lookups is one nobody reads when it matters.
    await trace(context(), 'not-an-identifier');
    expect(await db.select().from(auditLog).where(eq(auditLog.action, 'ops.trace_read'))).toHaveLength(0);
  });

  it('names no person anywhere in a trace (§11.9)', async () => {
    await raiseDemand();
    await client`INSERT INTO hospital.donor_demand_confirmations
                   (id, demand_id, donor_id, channel, donor_name, donor_phone,
                    blood_group, confirmed_at)
                 SELECT ${newId()}, id, ${newId()}, 'telegram',
                        'Sreelakshmi Nair', '+919999000011', 'O-', now()
                   FROM hospital.donor_demand LIMIT 1`;

    const result = await trace(context(), '100926-00042');
    const rendered = JSON.stringify(result);

    expect(result.steps.some((step) => step.stage === 'donor.confirmed')).toBe(true);
    expect(rendered).not.toContain('Sreelakshmi');
    expect(rendered).not.toContain('9999000011');
    expect(rendered).not.toContain('Fixture Doctor');
  });

  it('says what it cannot see, on a trace that worked', async () => {
    // The bot's own event log is not readable from here. An operator has to
    // know that before concluding nothing happened.
    const result = await trace(context(), '100926-00042');
    expect(result.notes.join(' ')).toContain('event log');
  });

  /* ----------------------------------------------------------------- board */

  it('reads the bot heartbeat as silence when it is stale', async () => {
    await db.insert(processHealth).values({
      process: 'bot',
      observedAt: new Date('2026-09-10T08:00:00.000Z'),
      status: 'ok',
      contractVersion: '1.3.0',
      alerts: [],
    });

    const board = await readBoard(context());
    const bot = board.heartbeats.find((beat) => beat.process === 'bot');

    // An hour old, and the row says "ok". A status column alone cannot tell
    // that apart from a bot that stopped an hour ago; the age can.
    expect(bot?.stale).toBe(true);
    expect(board.alerts.some((alert) => alert.kind === 'process.bot_silent')).toBe(true);
  });

  it('takes the bot alerts as published, and drops any sample ids with them', async () => {
    await db.insert(processHealth).values({
      process: 'bot',
      observedAt: clock.now(),
      status: 'degraded',
      contractVersion: '1.3.0',
      alerts: [
        {
          kind: 'bot.outbox_backlog',
          level: 'critical',
          title: 'Messages queued to donors and not sent',
          whatToDo: 'Check the chat tile.',
          count: 3,
          oldestAgeSeconds: 600,
          sample: ['a-donor-id-that-should-not-cross'],
        },
      ],
    });

    const board = await readBoard(context());
    const row = board.alerts.find((alert) => alert.kind === 'bot.outbox_backlog');

    expect(row?.count).toBe(3);
    // Read defensively: the ids the bot holds are donor ids, which this
    // application cannot resolve and has no business displaying.
    expect(row?.sample).toEqual([]);
  });

  it('reports a missing bot heartbeat as a gap rather than as health', async () => {
    const board = await readBoard(context());
    expect(board.gaps.join(' ')).toContain('never published');
  });

  /* --------------------------------------------------------------- metrics */

  it('computes percentiles from the samples, per route and per surface', async () => {
    const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 1000];
    for (const durationMs of durations) {
      await recordSample(context(), {
        surface: 'admin',
        route: '/panel',
        method: 'GET',
        status: 200,
        durationMs,
      });
    }
    await recordSample(context(), {
      surface: 'admin',
      route: '/panel',
      method: 'GET',
      status: 500,
      durationMs: 5,
    });

    const [route] = await routeMetrics(context());
    expect(route?.requests).toBe(11);
    expect(route?.errors).toBe(1);
    // A mean over that tail would read about 130ms and describe nobody. The p50
    // is where most people are and the p95 is where the waiting happens.
    expect(route?.p50Ms).toBeLessThan(100);
    expect(route?.p95Ms).toBeGreaterThanOrEqual(90);
    expect(route?.maxMs).toBe(1000);

    const [surface] = await surfaceMetrics(context());
    expect(surface?.surface).toBe('admin');
    expect(surface?.errorRate).toBeCloseTo(1 / 11, 3);

    const classes = await statusBreakdown(context());
    expect(classes.find((entry) => entry.statusClass === '5xx')?.count).toBe(1);
  });

  it('keeps the route pattern and never the path', async () => {
    // A path would put a request uuid into a table nobody thinks of as
    // clinical, and aggregation wants the pattern anyway.
    await recordSample(context(), {
      surface: 'staff',
      route: '/centre/requests/[id]',
      method: 'GET',
      status: 200,
      durationMs: 12,
    });

    const [row] = await routeMetrics(context());
    expect(row?.route).toBe('/centre/requests/[id]');
    expect(row?.route).not.toContain(requestUuid);
  });

  it('prunes what has fallen out of the window', async () => {
    await recordSample(context(), {
      surface: 'admin',
      route: '/panel',
      method: 'GET',
      status: 200,
      durationMs: 5,
    });

    clock.advanceDays(4);
    expect(await pruneSamples(context(), { keepHours: 48 })).toBe(1);
    expect(await routeMetrics(context())).toEqual([]);
  });

  it('never lets a metrics failure reach the request it is measuring', async () => {
    // Telemetry about a response that has already gone. Nothing here is worth
    // throwing over, so a broken pool is swallowed rather than propagated.
    const dead = postgres('postgres://nobody:nobody@127.0.0.1:1/none', {
      max: 1,
      connect_timeout: 1,
      onnotice: () => undefined,
    });

    try {
      await expect(
        recordSample(
          { ...context(), db: drizzle(dead) as unknown as Database },
          { surface: 'admin', route: '/panel', method: 'GET', status: 200, durationMs: 1 },
        ),
      ).resolves.toBeUndefined();
    } finally {
      await dead.end({ timeout: 5 }).catch(() => undefined);
    }
  });

  it('refuses an anonymous caller nothing, because reading is the admin route rule', () => {
    // Access is decided by the route rule and the page guard, not here. Stated
    // so nobody later mistakes the absence of a check in this module for an
    // absence of a check (§13's three layers).
    expect(anonymousActor.kind).toBe('anonymous');
  });
});
