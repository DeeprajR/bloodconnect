/**
 * The silent-failure board (§11.9).
 *
 * §11.9's alert list, made visible rather than emailed. Delivery is deferred on
 * purpose: routing an alert to a person needs somewhere to send it and somebody
 * on call, and a demo has neither. Making the state visible is the part that
 * has to exist first, because an alert nobody can look up is worse than a board
 * nobody is paged by.
 *
 * **The panel queries nothing itself.** Each module reports its own alerts
 * through its entry point, which is §11.2's rule applied to the one screen most
 * tempted to break it: a panel reading every table directly would be the single
 * place in the system where the module boundary did not hold, and it would be
 * the place holding the widest read of all.
 *
 * The bot's four arrive differently again, published onto `process_health`,
 * because `app_web` holds no grant on the `bot` schema at all.
 */

import { processHealth } from '@blood-connect/db';
import { rankAlerts, type Alert } from '@blood-connect/domain';
import { centreAlerts } from '@blood-connect/centre';
import { platformAlerts, type UseCaseContext } from '@blood-connect/platform';

import type { ProcessName } from './types.js';

export type Heartbeat = {
  readonly process: ProcessName;
  readonly observedAt: Date | null;
  readonly ageSeconds: number | null;
  readonly contractVersion: string | null;
  readonly buildId: string | null;
  /**
   * Whether the row is old enough that its contents mean nothing.
   *
   * This is the distinction a status column cannot make on its own: "the bot
   * says everything is fine" and "the bot has not said anything since Tuesday"
   * look identical until you read the timestamp, and the second is exactly what
   * §11.9 means by a silent failure.
   */
  readonly stale: boolean;
};

export type Board = {
  readonly alerts: readonly Alert[];
  readonly heartbeats: readonly Heartbeat[];
  /** Alerts the panel could not collect, and why. Never silently omitted. */
  readonly gaps: readonly string[];
};

/**
 * How long a heartbeat stays meaningful.
 *
 * The ticker's pass is measured in seconds, so five minutes is many missed
 * passes rather than one slow one. Short enough that a stopped bot is noticed
 * within a coffee break; long enough that a restart does not raise an alarm.
 */
const STALE_AFTER_SECONDS = 5 * 60;

export async function readBoard(ctx: UseCaseContext): Promise<Board> {
  const now = ctx.clock.now();
  const gaps: string[] = [];

  const rows = await ctx.db.select().from(processHealth);

  const heartbeats: Heartbeat[] = (['web', 'bot'] as const).map((process) => {
    const row = rows.find((candidate) => candidate.process === process);
    if (!row) {
      return {
        process,
        observedAt: null,
        ageSeconds: null,
        contractVersion: null,
        buildId: null,
        stale: true,
      };
    }
    const ageSeconds = Math.max(
      0,
      Math.floor((now.getTime() - row.observedAt.getTime()) / 1000),
    );
    return {
      process,
      observedAt: row.observedAt,
      ageSeconds,
      contractVersion: row.contractVersion,
      buildId: row.buildId,
      stale: ageSeconds > STALE_AFTER_SECONDS,
    };
  });

  /*
   * One module failing to report must not blank the board.
   *
   * The centre's query touching a table that is locked, or the bot's row being
   * absent on a fresh database, are both ordinary. A page that threw on either
   * would be a health screen that goes dark exactly when something is wrong,
   * so each source is caught and its absence is reported as a gap.
   */
  const collected = await Promise.all([
    collect('the platform', () => platformAlerts(ctx), gaps),
    collect('the blood centre', () => centreAlerts(ctx), gaps),
  ]);

  const botRow = rows.find((row) => row.process === 'bot');
  const botAlerts = readPublishedAlerts(botRow?.alerts);
  if (botRow === undefined) {
    gaps.push(
      'The bot has never published its health. Either it has not run against this database, or it is on a release older than contract 1.3.0.',
    );
  }

  const heartbeatAlerts: Alert[] = heartbeats
    .filter((beat) => beat.stale)
    .map((beat) => ({
      kind: `process.${beat.process}_silent`,
      level: 'critical',
      title:
        beat.process === 'bot'
          ? 'The donor bot has stopped reporting'
          : 'The web release has stopped reporting',
      whatToDo:
        beat.process === 'bot'
          ? 'Nothing on this page about the bot is current. Check the bot host is running: no waves are firing and no donor is being messaged.'
          : 'This heartbeat is written after a request, so a quiet deployment can show it late. If the page you are reading loaded, the web release is up.',
      count: 1,
      oldestAgeSeconds: beat.ageSeconds,
      sample: [],
    }));

  return {
    alerts: rankAlerts([...collected.flat(), ...botAlerts, ...heartbeatAlerts]),
    heartbeats,
    gaps,
  };
}

async function collect(
  who: string,
  read: () => Promise<readonly Alert[]>,
  gaps: string[],
): Promise<readonly Alert[]> {
  try {
    return await read();
  } catch {
    gaps.push(`${who} could not be asked for its alerts, so its rows are missing from this board.`);
    return [];
  }
}

/**
 * The bot's alerts, as they arrived.
 *
 * Read defensively because this is jsonb written by the *other release*, which
 * may be newer or older than this one. A shape we do not recognise is dropped
 * rather than rendered, and a `sample` is discarded outright: the ids the bot
 * holds are donor ids, which this application cannot resolve and has no
 * business displaying.
 */
function readPublishedAlerts(value: unknown): readonly Alert[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry): Alert[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const row = entry as Record<string, unknown>;
    if (typeof row['kind'] !== 'string' || typeof row['title'] !== 'string') return [];

    const level = row['level'];
    return [
      {
        kind: row['kind'],
        level: level === 'critical' || level === 'warning' ? level : 'info',
        title: row['title'],
        whatToDo: typeof row['whatToDo'] === 'string' ? row['whatToDo'] : 'Check the bot host.',
        count: typeof row['count'] === 'number' ? row['count'] : 0,
        oldestAgeSeconds:
          typeof row['oldestAgeSeconds'] === 'number' ? row['oldestAgeSeconds'] : null,
        sample: [],
      },
    ];
  });
}
