/**
 * `db:push` is a scratch-database tool and nothing else (§5.9, §11.5).
 *
 * Push diffs the schema straight onto a database without writing a migration.
 * That is useful while shaping a table and catastrophic anywhere the migration
 * history is the record of what happened — it would drop a column to make the
 * database match the code, and no file would say it had.
 *
 * So it is blocked in CI and in every deployed environment, and blocked here
 * against any database whose name does not announce itself as scratch.
 */

import { databaseUrl, isProductionLike, redact } from './env.js';

const SCRATCH_PATTERN = /(scratch|sandbox|_dev|dev_|playground)/i;

function refuse(reason: string): never {
  process.stderr.write(`db:push refused — ${reason}\n`);
  process.stderr.write(
    'Write a migration instead: `pnpm db:generate` then `pnpm db:migrate`.\n',
  );
  process.exit(1);
}

if (isProductionLike()) {
  refuse('NODE_ENV is production, or CI is set');
}

const url = databaseUrl('migrator');
const databaseName = url.split('/').pop()?.split('?')[0] ?? '';

if (!SCRATCH_PATTERN.test(databaseName)) {
  refuse(
    `${redact(url)} is not a scratch database. Name it something containing "scratch" if it really is one.`,
  );
}

process.stdout.write(`db:push allowed against scratch database ${databaseName}\n`);
