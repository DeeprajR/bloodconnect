/**
 * The bot process (§1).
 *
 * A separate deployable from the web application, on its own database role,
 * with its own migration set. It integrates with the centre through two shared
 * tables and no HTTP call in either direction.
 *
 * Two loops, deliberately separate:
 *
 *  - **The conversation loop** long-polls the channel and handles what arrives.
 *    It has no timers: an update is handled when it appears.
 *  - **The ticker** runs on an interval and polls *columns* — `next_wave_at`,
 *    the demand's status, `acknowledged_at`. Nothing that matters is held in
 *    this process, so a restart resumes rather than losing escalation (§5.7).
 *
 * If the conversation loop dies, recruitment continues and the outbox still
 * drains; if the ticker dies, people can still answer. Neither failure is
 * silent, because both report and the process exits non-zero.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  createBotDatabase,
  createChannelRegistry,
  createMemoryChannel,
  createTelegramChannel,
  drainOutbox,
  handleUpdate,
  tick,
  type BotContext,
  type ChannelPort,
} from '@blood-connect/bot';
import { createBotConfigCache } from '@blood-connect/bot';
import { CONTRACT_VERSION, checkContractVersion } from '@blood-connect/contract';
import { APP_TIMEZONE, dayOf } from '@blood-connect/domain';
import { idGenerator } from '@blood-connect/ids';

// The workspace root `.env`, loaded before anything reads a variable from it.
// This runs as plain Node, so nothing loads it otherwise.
const rootEnv = path.resolve(import.meta.dirname, '..', '..', '..', '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const TICK_INTERVAL_MS = Number(process.env['BOT_TICK_INTERVAL_MS'] ?? '15000');

/**
 * Which channel to run against.
 *
 * `memory` is not a test-only mode: §10 requires the system to be demonstrable
 * when the chat platform is not reachable, and running without a token is
 * exactly that. It is also what makes a first clone of this repository runnable
 * before anybody has spoken to @BotFather.
 */
const CHANNELS = ['telegram', 'memory'] as const;

function selectChannel(): ChannelPort {
  const choice = process.env['CHANNEL'] ?? 'telegram';
  const token = process.env['TELEGRAM_BOT_TOKEN'] ?? '';

  /**
   * An unrecognised channel refuses to start (§13).
   *
   * `CHANNEL` names the **platform**, and it is stored in
   * `donor_channels.channel` — it is not the bot's @username, which is
   * `TELEGRAM_BOT_USERNAME` and only appears in deep links. Anything else here
   * used to fall through to Telegram silently, so a value that meant nothing
   * looked like it was configuring something. It was set to the bot's username
   * once, and nothing said so.
   */
  if (!(CHANNELS as readonly string[]).includes(choice)) {
    process.stderr.write(
      `CHANNEL is "${choice}", which is not a channel. Use one of: ${CHANNELS.join(', ')}.\n` +
        'The bot\'s @username goes in TELEGRAM_BOT_USERNAME, not here.\n',
    );
    process.exit(1);
  }

  if (choice === 'memory' || token === '' || token === 'replace-me') {
    if (choice !== 'memory') {
      process.stdout.write(
        'TELEGRAM_BOT_TOKEN is not set — running on the in-memory channel.\n' +
          'Recruitment, screening and stand-downs all work; nothing leaves the process.\n' +
          'Set the token from @BotFather in .env to talk to real donors.\n',
      );
    }
    return createMemoryChannel();
  }

  return createTelegramChannel({ token });
}

async function main(): Promise<void> {
  const db = createBotDatabase();
  const channel = selectChannel();
  const channels = createChannelRegistry(channel);
  const config = createBotConfigCache(db);

  /* --- boot checks: refuse to start rather than run wrong (§6, §13) ----- */
  const { appConfig } = await import('@blood-connect/db');
  const configRows = await db
    .select({ key: appConfig.key, value: appConfig.value })
    .from(appConfig);
  const contractRow = configRows.find((row) => row.key === 'contract.version')?.value;

  // The column is jsonb, so a string arrives as a string and anything else is a
  // misconfiguration rather than something to coerce.
  const found = typeof contractRow === 'string' ? contractRow : '';
  const version = checkContractVersion(found);
  if (!version.ok) {
    // A mismatched deploy is a refused start, not silent corruption (§6).
    process.stderr.write(
      `contract version mismatch: this bot speaks ${CONTRACT_VERSION}, the database says ` +
        `${found}. ${version.reason}\n`,
    );
    process.exit(1);
  }

  const health = await channel.check();
  process.stdout.write(
    `channel ${channel.name}: ${health.ok ? 'ok' : 'UNREACHABLE'} — ${health.detail}\n`,
  );

  const context = async (): Promise<BotContext> => ({
    db,
    clock: {
      now: () => new Date(),
      today: (timeZone: string = APP_TIMEZONE) => dayOf(new Date(), timeZone),
    },
    ids: idGenerator,
    channel: channels,
    config: await config.get(),
    // One id per pass, so every write it causes is tied together (§14).
    correlationId: crypto.randomUUID(),
  });

  const controller = new AbortController();
  let stopping = false;

  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    process.stdout.write(`\n${signal} — finishing the current pass and stopping.\n`);
    controller.abort();
  };
  process.on('SIGINT', () => {
    stop('SIGINT');
  });
  process.on('SIGTERM', () => {
    stop('SIGTERM');
  });

  /* --- the ticker -------------------------------------------------------- */
  const runTicker = async (): Promise<void> => {
    while (!stopping) {
      try {
        const result = await tick(await context());
        const interesting =
          result.imported + result.wavesSent + result.cancelled + result.expired +
          result.completed + result.outcomesApplied + result.drain.sent;
        if (interesting > 0) {
          process.stdout.write(
            `tick: imported ${String(result.imported)}, waves ${String(result.wavesSent)} ` +
              `(${String(result.donorsNotified)} asked), cancelled ${String(result.cancelled)}, ` +
              `expired ${String(result.expired)}, completed ${String(result.completed)}, ` +
              `outcomes ${String(result.outcomesApplied)}, promoted ${String(result.promoted)}, ` +
              `sent ${String(result.drain.sent)}` +
              (result.drain.skipped > 0
                ? `, ${String(result.drain.skipped)} queued for a channel this process is not running`
                : '') +
              '\n',
          );
        }
      } catch (error) {
        // A failed pass must not stop the loop: the next one retries, and every
        // step it performs is idempotent by design.
        process.stderr.write(`tick failed: ${String(error)}\n`);
      }

      await new Promise((resolve) => setTimeout(resolve, TICK_INTERVAL_MS));
    }
  };

  /* --- the conversation loop -------------------------------------------- */
  const runConversation = async (): Promise<void> => {
    while (!stopping) {
      try {
        const updates = await channel.receive(controller.signal);
        for (const update of updates) {
          try {
            await handleUpdate(await context(), update);
          } catch (error) {
            // One malformed update must not stop the rest of the batch being
            // handled — somebody else is waiting on theirs.
            process.stderr.write(`update ${update.updateId} failed: ${String(error)}\n`);
          }
        }
        /**
         * Send what those replies queued, **now**.
         *
         * Replies go through the outbox so ordering holds — "you are confirmed"
         * must never arrive after "you are no longer needed". But the ticker was
         * the only thing draining it, so every tap waited up to a full tick
         * interval before anything came back, and the bot felt broken. Draining
         * here keeps the ordering and removes the wait.
         */
        if (updates.length > 0) {
          try {
            await drainOutbox(await context(), 20);
          } catch (error) {
            // The reply is already committed; the ticker's drain will retry it.
            process.stderr.write(`reply drain failed: ${String(error)}\n`);
          }
        } else {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        process.stderr.write(`receive failed: ${String(error)}\n`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  };

  process.stdout.write(
    `bot running: ticking every ${String(TICK_INTERVAL_MS / 1000)}s. Ctrl-C to stop.\n`,
  );

  await Promise.all([runTicker(), runConversation()]);
  process.stdout.write('stopped.\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`bot failed to start: ${String(error)}\n`);
  process.exit(1);
});
