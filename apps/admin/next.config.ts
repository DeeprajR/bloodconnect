import { existsSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * Load the workspace root `.env`.
 *
 * Next reads `.env` from the application directory, not from the root of a
 * monorepo — so without this, `pnpm dev` starts with no `DATABASE_URL` and the
 * first request that touches the database fails at runtime rather than at boot.
 *
 * One `.env` at the root rather than a copy per app, because the connection
 * strings, the bot token and the object-storage credentials are shared by the
 * web app, the worker, the bot and the seed runner. Two copies of a secret are
 * two things to keep in step, and the one that drifts is found the hard way.
 *
 * `loadEnvFile` does not overwrite a variable that is already set, so a value
 * exported in the shell or supplied by CI still wins.
 */
const rootEnv = path.resolve(import.meta.dirname, '..', '..', '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config: NextConfig = {
  reactStrictMode: true,
  // The workspace packages are TypeScript source; Next compiles them itself
  // rather than requiring a build step between edit and reload.
  transpilePackages: [
    '@blood-connect/config',
    '@blood-connect/db',
    '@blood-connect/domain',
    '@blood-connect/ids',
    '@blood-connect/platform',
    '@blood-connect/result',
  ],
  serverExternalPackages: ['postgres', '@node-rs/argon2'],
  poweredByHeader: false,
  typedRoutes: true,
};

export default config;
