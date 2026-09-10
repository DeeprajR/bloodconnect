/**
 * Applies `db/migrations-bot` as the migrator role (§5.9).
 *
 * The bot release's own migration set. It creates the `bot` schema and nothing
 * else. The two shared contract tables belong to `db/migrations`, and
 * `pnpm check:bot-migrations` fails the build if this set ever mentions them.
 *
 * Its own `__drizzle_migrations` table, in the `bot` schema, so the two sets
 * track their progress independently and can be applied in either order by
 * releases that ship separately.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { databaseUrl, redact } from './env.js';
import { findUp } from './paths.js';

const migrationsFolder = findUp(
  'migrations-bot',
  path.dirname(fileURLToPath(import.meta.url)),
);

async function main(): Promise<void> {
  const url = databaseUrl('migrator');
  process.stdout.write(`applying bot migrations to ${redact(url)}\n`);

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), {
      migrationsFolder,
      migrationsSchema: 'bot',
      migrationsTable: '__drizzle_migrations',
    });
    process.stdout.write('bot migrations applied\n');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`bot migration failed: ${String(error)}\n`);
  process.exit(1);
});
