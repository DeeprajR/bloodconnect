import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs with this package as its working directory, and the shared
// `.env` lives one level up at the workspace root.
const rootEnv = path.resolve(process.cwd(), '..', '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/**
 * Migrations only, never auto-create (§11.5). `drizzle-kit push` is guarded by
 * `src/push-guard.ts`, which refuses to run against anything but a scratch
 * database.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  schemaFilter: ['hospital', 'reference'],
  dbCredentials: {
    url: process.env['MIGRATION_DATABASE_URL'] ?? process.env['DATABASE_URL'] ?? '',
  },
  strict: true,
  verbose: true,
});
