/**
 * The bot's migrations must never mention a shared contract table (§2.1, §5.9).
 *
 * §5.9 asks for exactly this check by name: "a CI check greps `migrations-bot`
 * for `donor_demand` and fails the build if it appears." The two shared tables
 * are created **only** by `db/migrations`, applied by the web release. Two
 * releases both creating the same table is how the contract stops being one
 * contract.
 *
 * It also proves it can fail, for the same reason every other check here does:
 * a grep that would pass over a violation is a green tick meaning nothing.
 *
 *   node scripts/check-bot-migrations.mjs
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const folder = path.join(root, 'db', 'migrations-bot');

/** Anything that would create or alter a table the other release owns. */
const FORBIDDEN = [
  'donor_demand',
  'donor_demand_confirmations',
  'hospital.',
  'blood_bags',
  'blood_requests',
  'centre_decisions',
];

/** The reference hierarchy is shared and read-only to the bot (§5.8). */
const ALLOWED_REFERENCES = ['reference.location_nodes'];

const strip = (sql) =>
  sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

let failures = 0;

const files = await readdir(folder).catch(() => []);
const sqlFiles = files.filter((name) => name.endsWith('.sql'));

if (sqlFiles.length === 0) {
  console.log('no bot migrations yet — nothing to check');
}

for (const name of sqlFiles) {
  const raw = await readFile(path.join(folder, name), 'utf8');
  let body = strip(raw);
  for (const allowed of ALLOWED_REFERENCES) body = body.split(allowed).join('');

  for (const term of FORBIDDEN) {
    if (body.includes(term)) {
      failures += 1;
      console.error(
        `  BAD ${name} mentions "${term}" — the shared contract and the hospital schema ` +
          'belong to db/migrations, applied by the web release (§2.1).',
      );
    }
  }
}

if (failures === 0) {
  console.log(
    `bot migrations mention no table owned by the web release (${sqlFiles.length} file(s) checked).`,
  );
}

/* --- and prove the check can go red -------------------------------------- */

const violating = `CREATE TABLE "bot"."x" ("id" uuid);\nALTER TABLE "hospital"."donor_demand" ADD COLUMN "sneaky" text;`;
const detected = FORBIDDEN.some((term) => strip(violating).includes(term));

if (!detected) {
  console.error('  BAD the check did not reject a migration that alters donor_demand');
  failures += 1;
} else {
  console.log('check correctly rejects a bot migration that touches donor_demand.');
}

process.exit(failures === 0 ? 0 : 1);
