/**
 * Clinical configuration, read by the bot (§12).
 *
 * The same `hospital.app_config` rows the web application reads, on a
 * SELECT-only grant. §12's second rule is that the SQL wave query and the
 * TypeScript predicate take their thresholds from the same place — and those
 * two readings live in different processes, so "the same place" has to mean the
 * same table rather than two copies that happen to agree today.
 *
 * The bot cannot write here, and holds no grant to try. Shortening an
 * inter-donation interval is the one edit in this system that could physically
 * harm somebody, and it belongs to the screen that audits it.
 *
 * Cached for a minute, like the web app's loader, so a hot ticker does not
 * query per pass and a change is picked up without a restart.
 */

import { appConfig } from '@blood-connect/db';
import {
  CONFIG_DEFAULTS,
  createConfigCache,
  resolveConfig,
  type AppConfig,
} from '@blood-connect/config';

import type { BotDatabase } from './db.js';

export async function loadBotConfig(db: BotDatabase): Promise<AppConfig> {
  const rows = await db.select({ key: appConfig.key, value: appConfig.value }).from(appConfig);

  const overrides: Record<string, unknown> = {};
  for (const row of rows) {
    // `contract.version` shares this table but is not clinical configuration
    // (§6). Passing it to the resolver would report it as an unknown key and
    // take every real override down with it — the same reason the web app's
    // loader skips it.
    if (row.key.startsWith('contract.')) continue;
    overrides[row.key] = row.value;
  }

  const resolved = resolveConfig(overrides);
  if (resolved.ok) return resolved.config;

  /**
   * A bad row must not start the bot on silently different thresholds.
   *
   * §13 says a process refuses to start on a misconfiguration rather than
   * running with a default nobody chose — and here that default would decide
   * who gets asked to give blood.
   */
  throw new Error(
    `app_config is invalid and the bot will not start: ${resolved.problems
      .map((problem) =>
        problem.kind === 'unknown_key'
          ? `unknown key ${problem.key}`
          : `${problem.key}: ${problem.message}`,
      )
      .join('; ')}`,
  );
}

export function createBotConfigCache(
  db: BotDatabase,
  now: () => number = () => Date.now(),
): { get: () => Promise<AppConfig>; invalidate: () => void } {
  return createConfigCache(() => loadBotConfig(db), now);
}

export { CONFIG_DEFAULTS };
