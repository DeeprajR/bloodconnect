/**
 * Which configuration is this deployment actually running (§12, §11.9).
 *
 * The first question of most incidents, and the one nobody can answer from a
 * running system without this screen. §12 puts clinical thresholds in rows, and
 * a row that overrides a default is invisible from the code: reading
 * `packages/config` tells you what the default is, not what this database says.
 *
 * So the panel shows both, side by side, and says which is in force. Read-only:
 * changing a threshold is a clinical decision with its own audited screen, and
 * an operations panel that could quietly move one would be a way to change
 * medical behaviour without anybody reviewing it.
 */

import { asc, sql } from 'drizzle-orm';
import { CONTRACT_VERSION } from '@blood-connect/contract';
import { CONFIG_KEYS, defaultFor } from '@blood-connect/config';
import { appConfig } from '@blood-connect/db';
import type { UseCaseContext } from '@blood-connect/platform';

export type ConfigRow = {
  readonly key: string;
  readonly value: unknown;
  readonly isDefault: boolean;
  readonly defaultValue: unknown;
  readonly effectiveFrom: Date | null;
};

export type Deployment = {
  readonly config: readonly ConfigRow[];
  /** What this process compiled against, which may differ from the stored one. */
  readonly compiledContractVersion: string;
  readonly storedContractVersion: string | null;
  readonly buildId: string | null;
  readonly nodeVersion: string;
  readonly migrationsApplied: number;
  readonly lastMigrationAt: Date | null;
};

export async function readDeployment(ctx: UseCaseContext): Promise<Deployment> {
  const rows = await ctx.db
    .select({
      key: appConfig.key,
      value: appConfig.value,
      effectiveFrom: appConfig.effectiveFrom,
    })
    .from(appConfig)
    .orderBy(asc(appConfig.key));

  const stored = new Map(rows.map((row) => [row.key, row]));

  /*
   * Every configurable key, not only the overridden ones.
   *
   * A screen listing three rows because three are overridden invites the wrong
   * conclusion: that the other forty do not exist, rather than that they sit at
   * their defaults. During an incident that difference matters.
   */
  const config: ConfigRow[] = CONFIG_KEYS.map((key) => {
    const row = stored.get(key);
    return {
      key,
      value: row ? row.value : defaultFor(key),
      isDefault: row === undefined,
      defaultValue: defaultFor(key),
      effectiveFrom: row?.effectiveFrom ?? null,
    };
  });

  const contractRow = stored.get('contract.version');
  const migrations = await appliedMigrations(ctx);

  return {
    config,
    compiledContractVersion: CONTRACT_VERSION,
    storedContractVersion: typeof contractRow?.value === 'string' ? contractRow.value : null,
    buildId: process.env['BUILD_ID'] ?? null,
    nodeVersion: process.version,
    migrationsApplied: migrations.length,
    lastMigrationAt: migrations.at(-1) ?? null,
  };
}

/**
 * What the migrator says it has run.
 *
 * Read from the migrator's own bookkeeping rather than from the folder on disk,
 * because the folder says what this build ships and the table says what this
 * database has. When those two disagree, the disagreement is the incident.
 *
 * Wrapped, because a database that cannot answer this is a database the tile
 * above has already reported as down, and this page has to render anyway.
 */
async function appliedMigrations(ctx: UseCaseContext): Promise<readonly Date[]> {
  try {
    const rows = await ctx.db.execute<{ created_at: string | number }>(
      sql`SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at ASC`,
    );
    const list: { created_at: string | number }[] = Array.isArray(rows) ? rows : [];
    return list.map((row) => new Date(Number(row.created_at)));
  } catch {
    return [];
  }
}
