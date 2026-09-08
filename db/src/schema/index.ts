/**
 * The schema the web release owns: `hospital` and `reference` (§5.9).
 *
 * The bot's tables live in `db/migrations-bot`, applied by the bot's release,
 * and are not exported here. The two shared contract tables are created **only**
 * by this set — a CI check greps the bot migrations for `donor_demand` and fails
 * the build if it appears (§2.1).
 */
export * from './reference.js';
export * from './platform.js';
export * from './accounts.js';
