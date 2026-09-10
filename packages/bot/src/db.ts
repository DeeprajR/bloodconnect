/**
 * The database connection for `app_bot` (§5.1).
 *
 * A **different role** from the web application's, and that is the whole point:
 * `app_bot` can see the `bot` schema, read `reference`, and touch exactly the
 * contract columns of the two shared tables. It cannot read a patient row, and
 * not because the code avoids it, because the grant does not exist (§5.1).
 *
 * This is the only file in the bot that names a connection string.
 */

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as botSchema from '@blood-connect/db/bot';

export type BotDatabase = PostgresJsDatabase<typeof botSchema>;

/** A transaction handle. A use case opens exactly one; a repository never does. */
export type BotTransaction = Parameters<Parameters<BotDatabase['transaction']>[0]>[0];

const connectionString = (): string => {
  const url = process.env['BOT_DATABASE_URL'];
  if (!url) {
    // Secrets are validated at boot and the process refuses to start on a
    // missing one (§13). A default here would connect somewhere quietly, and
    // the wrong somewhere would be the web app's role.
    throw new Error(
      'BOT_DATABASE_URL is not set. From the workspace root: `cp .env.example .env`, ' +
        'then `pnpm up` to start Postgres.',
    );
  }
  return url;
};

export function createBotDatabase(url: string = connectionString()): BotDatabase {
  const client = postgres(url, {
    max: 10,
    idle_timeout: 20,
    onnotice: () => undefined,
  });
  return drizzle(client, { schema: botSchema });
}
