/**
 * Global test setup: bring the test database up to both migration sets.
 *
 * The suite runs against real Postgres (§17), and the schema it runs against
 * must be the one the migrations produce, not one a test built for itself. So
 * this applies `db/migrations` to `TEST_DATABASE_URL` before anything runs, and
 * every database test then asserts against the real thing.
 *
 * With no `TEST_DATABASE_URL`, the database suites skip and the pure ones still
 * run: a clone of this repository should be able to run `pnpm test` before it
 * has Docker up.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { existsSync } from 'node:fs';
import path from 'node:path';

export async function setup(): Promise<void> {
  const envFile = path.resolve(import.meta.dirname, '..', '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const url = process.env['TEST_DATABASE_URL'];
  if (!url) {
    process.stdout.write(
      'TEST_DATABASE_URL is not set. Database suites will skip. Run `pnpm up` to include them.\n',
    );
    return;
  }

  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    // Both sets, in release order. The bot's migrations are a separate set
    // applied by a separate release (§5.9), and the suite has to run against
    // the same two schemas production does.
    await migrate(drizzle(sql), {
      migrationsFolder: path.resolve(import.meta.dirname, 'migrations'),
    });
    await migrate(drizzle(sql), {
      migrationsFolder: path.resolve(import.meta.dirname, 'migrations-bot'),
      migrationsSchema: 'bot',
      migrationsTable: '__drizzle_migrations',
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
