/**
 * The bot's diagnostic command (§5, backend-architecture.md §14, build plan P13).
 *
 * "Checks channel credentials, network, database and port and says what to
 * do about each failure." `main.ts` already runs the contract-version and
 * channel checks once at boot, folded into the startup log; this is the same
 * checks, pulled out so they can be run **without** starting the ticker or
 * the conversation loop — the thing to reach for before a demo, or when
 * something in the loop looks stuck and the question is "is the bot even
 * configured right", not "let it run and see".
 *
 * Exits 0 when every check passes, 1 otherwise, so it composes with a
 * pre-demo script or a CI smoke step.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';

import { createBotDatabase, createMemoryChannel, createTelegramChannel } from '@blood-connect/bot';
import { CONTRACT_VERSION, checkContractVersion } from '@blood-connect/contract';

const rootEnv = path.resolve(import.meta.dirname, '..', '..', '..', '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

type Check = {
  readonly label: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly whatToDo: string;
};

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function checkDatabase(): Promise<Check> {
  const label = 'Database';
  try {
    const db = createBotDatabase();
    const rows = await db.execute(sql`SELECT 1 AS one`);
    const returned = Array.isArray(rows) ? rows.length : 1;
    return returned > 0
      ? { label, ok: true, detail: 'Round trip returned a row.', whatToDo: 'Nothing to do.' }
      : {
          label,
          ok: false,
          detail: 'The query returned nothing, which should be impossible.',
          whatToDo: 'Check the Postgres logs; this is not a connectivity failure.',
        };
  } catch (cause) {
    return {
      label,
      ok: false,
      detail: messageOf(cause),
      whatToDo:
        'Check BOT_DATABASE_URL in .env and that Postgres is up (`pnpm up`). ' +
        'The bot connects as app_bot, a different role from the web app.',
    };
  }
}

async function checkChannel(): Promise<Check> {
  const label = 'Chat channel';
  const choice = process.env['CHANNEL'] ?? 'telegram';
  const token = process.env['TELEGRAM_BOT_TOKEN'] ?? '';

  const channel =
    choice === 'memory' || token === '' || token === 'replace-me'
      ? createMemoryChannel()
      : createTelegramChannel({ token });

  try {
    const health = await channel.check();
    return {
      label: `${label} (${channel.name})`,
      ok: health.ok,
      detail: health.detail,
      whatToDo: health.ok
        ? 'Nothing to do.'
        : channel.name === 'memory'
          ? 'Running on the in-memory channel by design — nothing to reach.'
          : 'Check TELEGRAM_BOT_TOKEN in .env and that this host can reach api.telegram.org.',
    };
  } catch (cause) {
    return {
      label: `${label} (${channel.name})`,
      ok: false,
      detail: messageOf(cause),
      whatToDo: 'Check TELEGRAM_BOT_TOKEN in .env and network access to api.telegram.org.',
    };
  }
}

async function checkContract(): Promise<Check> {
  const label = 'Contract version';
  try {
    const db = createBotDatabase();
    const { appConfig } = await import('@blood-connect/db');
    const rows = await db
      .select({ key: appConfig.key, value: appConfig.value })
      .from(appConfig);
    const stored = rows.find((row) => row.key === 'contract.version')?.value;
    const found = typeof stored === 'string' ? stored : '';

    if (found === '') {
      return {
        label,
        ok: false,
        detail: 'No contract version is stored.',
        whatToDo: 'The database has not been seeded. Run `pnpm db:seed` from the workspace root.',
      };
    }

    const check = checkContractVersion(found);
    return check.ok
      ? { label, ok: true, detail: `Both sides on ${found}.`, whatToDo: 'Nothing to do.' }
      : {
          label,
          ok: false,
          detail: `${check.reason}. This bot compiled against ${CONTRACT_VERSION}, the database says ${found}.`,
          whatToDo: 'Ship the bot and the web release together, or roll the newer one back.',
        };
  } catch (cause) {
    return {
      label,
      ok: false,
      detail: messageOf(cause),
      whatToDo: 'Could not read app_config. Check the database check above first.',
    };
  }
}

async function main(): Promise<void> {
  process.stdout.write('bot diagnostic\n\n');

  const checks = await Promise.all([checkDatabase(), checkChannel(), checkContract()]);

  let allOk = true;
  for (const check of checks) {
    allOk &&= check.ok;
    process.stdout.write(`${check.ok ? 'OK  ' : 'FAIL'}  ${check.label}\n`);
    process.stdout.write(`      ${check.detail}\n`);
    if (!check.ok) process.stdout.write(`      → ${check.whatToDo}\n`);
    process.stdout.write('\n');
  }

  process.stdout.write(allOk ? 'All checks passed.\n' : 'One or more checks failed.\n');
  process.exit(allOk ? 0 : 1);
}

main().catch((error: unknown) => {
  process.stderr.write(`diagnostic failed to run: ${messageOf(error)}\n`);
  process.exit(1);
});
