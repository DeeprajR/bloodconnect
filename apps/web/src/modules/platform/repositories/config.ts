/**
 * The configuration loader (§12).
 *
 * `app_config` rows are merged onto the defaults in `packages/config` and
 * validated as a whole. A row that does not validate does not silently apply a
 * partial change: the loader refuses it, logs which key, and serves the last
 * good configuration.
 *
 * That refusal direction matters. These are clinical thresholds — a minimum
 * donor weight or an inter-donation interval. Falling back to a known-good set
 * is safe; applying half of an edit is not.
 */

import { appConfig } from '@blood-connect/db';
import {
  CONFIG_DEFAULTS,
  createConfigCache,
  resolveConfig,
  type AppConfig,
} from '@blood-connect/config';

import { db, type Database } from '@/db/client';

/**
 * Keys that live in `app_config` but are not clinical configuration.
 *
 * `contract.version` is the value both processes assert against at boot (§6).
 * It shares the table because it is the same kind of thing — a row an operator
 * can read — but it is not part of `AppConfig`, and passing it to the resolver
 * would report it as an unknown key and drop every real override with it.
 */
const RESERVED_PREFIXES = ['contract.'] as const;

const isReserved = (key: string): boolean =>
  RESERVED_PREFIXES.some((prefix) => key.startsWith(prefix));

export async function loadConfig(source: Database = db): Promise<AppConfig> {
  const rows = await source.select({ key: appConfig.key, value: appConfig.value }).from(appConfig);

  const overrides = Object.fromEntries(
    rows.filter((row) => !isReserved(row.key)).map((row) => [row.key, row.value]),
  );
  const resolved = resolveConfig(overrides);

  if (!resolved.ok) {
    for (const problem of resolved.problems) {
      process.stderr.write(
        `app_config: ignoring ${problem.kind} for "${problem.key}" — serving defaults\n`,
      );
    }
    return CONFIG_DEFAULTS;
  }

  return resolved.config;
}

/**
 * Sixty seconds (§12), so a hot path does not query per request and a change is
 * picked up without a restart. The clock is injected into the cache for the
 * same reason it is injected everywhere else.
 */
const cache = createConfigCache(
  () => loadConfig(),
  () => Date.now(),
);

export const currentConfig = (): Promise<AppConfig> => cache.get();

/** Called by `setConfig` once it has written, so the change is visible at once. */
export const invalidateConfigCache = (): void => {
  cache.invalidate();
};
