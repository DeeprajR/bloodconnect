/**
 * The database connection for `app_web` (§5.1).
 *
 * One pool per process, reused across hot reloads in development. Next
 * re-evaluates modules on every edit, and a new pool per reload exhausts
 * Postgres' connection limit within a few minutes of work.
 *
 * This is the only file that names a connection string. Nothing above it knows
 * there is a driver.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '@blood-connect/db';

const connectionString = (): string => {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    // Secrets are validated at boot and the process refuses to start on a
    // missing one (§13). A default here would be a silent misconfiguration,
    // and the worst kind, because it would quietly connect somewhere.
    throw new Error(
      'DATABASE_URL is not set. From the workspace root: `cp .env.example .env`, ' +
        'then `pnpm up` to start Postgres. The root .env is loaded by next.config.ts.',
    );
  }
  return url;
};

const createClient = (): postgres.Sql =>
  postgres(connectionString(), {
    max: 10,
    idle_timeout: 20,
    // Notices are not errors, and they bury the ones that are.
    onnotice: () => undefined,
  });

declare global {
  var __bloodConnectSql: postgres.Sql | undefined;
}

const client = globalThis.__bloodConnectSql ?? createClient();
if (process.env['NODE_ENV'] !== 'production') globalThis.__bloodConnectSql = client;

export const db = drizzle(client, { schema });

export type Database = typeof db;

/**
 * A transaction handle. Use cases open exactly one and pass it down; a
 * repository never opens its own (§3).
 */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export { schema };
