/**
 * The bot's use-case context (§3).
 *
 * Same shape and same reasons as the web application's: time, randomness and
 * the channel are injected rather than reached for, and the use case is the
 * transaction boundary.
 *
 * One connection, two schemas. `db` owns everything in `bot`; it also reaches
 * `hospital.donor_demand` and `hospital.donor_demand_confirmations`, which it
 * does **not** own — those are the shared contract (§7), and what keeps the bot
 * inside its half of them is not this type but the column-level grants: it
 * physically cannot set `units`, and every attempt to reach any other
 * `hospital` table is a permission error rather than a code review finding.
 */

import type { AppConfig } from '@blood-connect/config';
import type { Clock } from '@blood-connect/domain';
import type { IdGenerator } from '@blood-connect/ids';

import type { BotDatabase, BotTransaction } from './db.js';
import type { ChannelRegistry } from './ports/channel.js';

export type BotContext = {
  readonly db: BotDatabase;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** Delivery is a lookup by the row's own channel, never one global port. */
  readonly channel: ChannelRegistry;
  readonly config: AppConfig;
  /** Ties one unit of blood end to end, across both processes (§14). */
  readonly correlationId: string;
};

export type BotTransactionContext = Omit<BotContext, 'db'> & {
  readonly db: BotTransaction;
};
