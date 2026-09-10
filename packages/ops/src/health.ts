/**
 * Health, not liveness (§11.9).
 *
 * Every check here does the dependency's actual job. A TCP probe against
 * Postgres stays green while the connection pool is exhausted; a ping at the
 * SMTP port stays green while the credentials are wrong; a reachable MinIO
 * stays green while the bucket is missing. All three of those are outages to
 * the person trying to use the system, and none of them is an outage to a ping.
 *
 * Each tile reports what to do about it. §11.9's own words: a red tile that
 * does not say what broke is a pager that wakes somebody up for nothing. The
 * `detail` on a failure is the driver's message, unedited, because the person
 * reading this at 3am wants the actual error and not our paraphrase of it.
 */

import { CONTRACT_VERSION, CONTRACT_VERSION_CONFIG_KEY, checkContractVersion } from '@blood-connect/contract';
import { appConfig } from '@blood-connect/db';
import { eq } from 'drizzle-orm';
import {
  checkDatabase,
  messageOf,
  type EmailPort,
  type StoragePort,
  type UseCaseContext,
} from '@blood-connect/platform';

import { type HealthStatus } from './types.js';

export type Dependency =
  | 'database'
  | 'email'
  | 'storage'
  | 'chat'
  | 'contract';

export type HealthTile = {
  readonly dependency: Dependency;
  readonly label: string;
  readonly status: HealthStatus;
  readonly detail: string;
  /** What an operator should do. Present on every tile, not just the red ones. */
  readonly whatToDo: string;
  readonly checkedAt: Date;
  readonly latencyMs: number;
};

type Outcome = { ok: boolean; detail: string; degraded?: boolean };
type Probe = () => Promise<Outcome>;

/**
 * Every probe is bounded and every probe is caught.
 *
 * A health check that can hang is a health screen that can hang, which is the
 * one screen that must render when everything else is broken. Six seconds is
 * longer than any of these should take and shorter than a person's patience.
 */
async function timed(
  dependency: Dependency,
  label: string,
  whatToDo: { ok: string; bad: string },
  probe: Probe,
  now: Date,
  timeoutMs = 6000,
): Promise<HealthTile> {
  const started = Date.now();

  const outcome = await Promise.race<Outcome>([
    probe().catch((cause: unknown) => ({ ok: false, detail: messageOf(cause) })),
    new Promise<Outcome>((resolve) =>
      setTimeout(
        () => {
          resolve({ ok: false, detail: `No answer within ${timeoutMs / 1000} seconds.` });
        },
        timeoutMs,
      ),
    ),
  ]);

  const degraded = outcome.degraded ?? false;

  return {
    dependency,
    label,
    status: outcome.ok ? (degraded ? 'degraded' : 'ok') : 'down',
    detail: outcome.detail,
    whatToDo: outcome.ok && !degraded ? whatToDo.ok : whatToDo.bad,
    checkedAt: now,
    latencyMs: Date.now() - started,
  };
}

export type HealthPorts = {
  readonly email: EmailPort;
  readonly storage: StoragePort;
};

/**
 * The dependency tiles the web release can check for itself.
 *
 * The chat platform is not among them: reaching Telegram requires the bot
 * token, and §5 keeps that on the bot host. The panel learns the chat channel's
 * state from the bot's published heartbeat instead, which is the same boundary
 * every other bot fact crosses.
 */
export async function checkDependencies(
  ctx: UseCaseContext,
  ports: HealthPorts,
): Promise<readonly HealthTile[]> {
  const now = ctx.clock.now();

  return Promise.all([
    timed(
      'database',
      'Database',
      {
        ok: 'Nothing to do.',
        bad: 'Nothing works without this. Check the Postgres container and the connection pool before anything else on this page.',
      },
      () => checkDatabase(ctx),
      now,
    ),
    timed(
      'email',
      'Email (SMTP)',
      {
        ok: 'Nothing to do.',
        bad: 'Invites, reset codes and address-change warnings are queued and will not leave. Check the SMTP host and credentials.',
      },
      () => probeEmail(ports.email),
      now,
    ),
    timed(
      'storage',
      'Object storage',
      {
        ok: 'Nothing to do.',
        bad: 'Signature seals cannot be read or uploaded. Check the bucket exists and the credentials still work.',
      },
      () => probeStorage(ports.storage),
      now,
    ),
    timed(
      'contract',
      'Contract version',
      {
        ok: 'Nothing to do.',
        bad: 'The two releases disagree about the shared tables. Ship them together, or roll the newer one back.',
      },
      () => probeContract(ctx),
      now,
    ),
  ]);
}

/* -------------------------------------------------------------------------- */

/**
 * A handshake, not a send.
 *
 * The port's `send` is the real job, and running it here would mean this page
 * emitted an email every time somebody opened it. So the probe asks the adapter
 * to verify itself where it can, and reports what it learned.
 */
async function probeEmail(port: EmailPort): Promise<Outcome> {
  if (!port.verify) {
    // An in-memory adapter has nothing to verify, and saying so is more useful
    // than a green tile that implies a mail server was reached.
    return { ok: true, degraded: true, detail: 'In-memory adapter. Nothing leaves this process.' };
  }
  return port.verify();
}

/**
 * A `HEAD` against the bucket, which is what §11.9 asks for.
 *
 * Never `get`. That method swallows every error by design, so a deleted bucket
 * and an absent key look the same through it, and a tile built on it would be
 * green against a stopped object store. This was found by stopping the
 * container rather than by reading the code.
 */
async function probeStorage(port: StoragePort): Promise<Outcome> {
  if (!port.verify) {
    return { ok: true, degraded: true, detail: 'In-memory store. Nothing leaves this process.' };
  }
  return port.verify();
}

async function probeContract(ctx: UseCaseContext): Promise<{ ok: boolean; detail: string }> {
  const [row] = await ctx.db
    .select({ value: appConfig.value })
    .from(appConfig)
    .where(eq(appConfig.key, CONTRACT_VERSION_CONFIG_KEY));

  const found = typeof row?.value === 'string' ? row.value : null;
  if (found === null) {
    return { ok: false, detail: 'No contract version is stored. The database has not been seeded.' };
  }

  const check = checkContractVersion(found);
  return check.ok
    ? { ok: true, detail: `Both sides on ${found}.` }
    : { ok: false, detail: `${check.reason}. Compiled ${CONTRACT_VERSION}, stored ${found}.` };
}
