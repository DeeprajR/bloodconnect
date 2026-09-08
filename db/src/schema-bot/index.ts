/**
 * The schema the **bot release** owns: `bot`, and nothing else (§5.9).
 *
 * Exported separately from `@blood-connect/db` so the web app cannot reach a
 * donor table by accident — §5.1's privacy boundary is a missing grant in the
 * database and a missing import here, and both are deliberate.
 *
 * The two shared contract tables are **not** re-exported from this entry point.
 * The bot reads and writes them through the main export, on the columns §7 gives
 * it and no others, and its migrations never create them.
 */
export * from './bot.js';
