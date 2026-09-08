/**
 * Connection strings, parsed once at the edge (§3).
 *
 * Three roles, three URLs, and they are deliberately not interchangeable: the
 * migrator holds DDL rights that neither application role has (§5.9), and
 * `app_web` and `app_bot` differ by the grants that make the privacy boundary
 * real (§5.1). A process that reaches for the wrong one should fail loudly here
 * rather than quietly succeed with more privilege than it should have.
 */

export type Role = 'migrator' | 'app_web' | 'app_bot';

const VARIABLE: Readonly<Record<Role, string>> = {
  migrator: 'MIGRATION_DATABASE_URL',
  app_web: 'DATABASE_URL',
  app_bot: 'BOT_DATABASE_URL',
};

export function databaseUrl(role: Role): string {
  const name = VARIABLE[role];
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env, then run \`pnpm up\` to start Postgres.`,
    );
  }
  return value;
}

/** Redacts the password so a connection string can safely appear in a log. */
export const redact = (url: string): string => url.replace(/:\/\/([^:@/]+):[^@]*@/, '://$1:***@');

export const nodeEnv = (): string => process.env['NODE_ENV'] ?? 'development';

export const isProductionLike = (): boolean =>
  nodeEnv() === 'production' || process.env['CI'] === 'true';
