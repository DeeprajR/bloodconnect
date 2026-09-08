import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs with this package as its working directory, and the shared
// `.env` lives one level up at the workspace root.
const rootEnv = path.resolve(process.cwd(), '..', '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/**
 * The **second** migration set (§5.9): the `bot` schema, applied by the bot's
 * own release.
 *
 * `schemaFilter` is `['bot']` and nothing else. That is what keeps the two
 * shared contract tables out of this set — they are created only by
 * `db/migrations`, and `scripts/check-bot-migrations.mjs` fails the build if
 * `donor_demand` ever appears here (§2.1).
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema-bot/index.ts',
  out: './migrations-bot',
  schemaFilter: ['bot'],
  dbCredentials: {
    url: process.env['MIGRATION_DATABASE_URL'] ?? process.env['DATABASE_URL'] ?? '',
  },
  strict: true,
  verbose: true,
});
