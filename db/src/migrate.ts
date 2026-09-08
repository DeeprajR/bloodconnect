/**
 * Applies `db/migrations` as the migrator role (§5.9).
 *
 * Forward-only, and the only creator of the `hospital` and `reference` schemas —
 * including the two shared contract tables, which the bot's migrations must
 * never mention (§2.1).
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { databaseUrl, redact } from './env.js';
import { findUp } from './paths.js';

const migrationsFolder = findUp(
  'migrations',
  path.dirname(fileURLToPath(import.meta.url)),
);

async function main(): Promise<void> {
  const url = databaseUrl('migrator');
  process.stdout.write(`applying migrations to ${redact(url)}\n`);

  // `max: 1` because migrations must run in one session, in order.
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder });
    process.stdout.write('migrations applied\n');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`migration failed: ${String(error)}\n`);
  process.exit(1);
});
