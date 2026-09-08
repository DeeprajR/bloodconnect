/**
 * The bot's append-only event log (§2.9, §14).
 *
 * Written on the same transaction handle as the thing it records, so the event
 * and the change commit together or not at all. An event written after the
 * commit is one that can go missing exactly when it matters.
 *
 * Append-only by grant, not by convention: `app_bot` holds no UPDATE or DELETE
 * on this table (migration 0001 of the bot set).
 *
 * **No personal or health data** (§11.9, §12). Donor ids, never names; request
 * public ids, never patient details. A screening answer is a health datum, so
 * what is logged is that a question was answered, not what the answer was.
 */

import { eventLog } from '@blood-connect/db/bot';
import { newId } from '@blood-connect/ids';

import type { BotTransaction } from './db.js';

export type BotEvent = {
  /** Past tense, dotted: `donor.registered`, `journey.confirmed`. */
  readonly event: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly metadata?: Record<string, unknown>;
};

export type EventWriter = (entry: BotEvent) => Promise<void>;

export function createEventWriter(
  tx: BotTransaction,
  correlationId: string,
  occurredAt: Date,
): EventWriter {
  return async (entry: BotEvent): Promise<void> => {
    await tx.insert(eventLog).values({
      id: newId(),
      occurredAt,
      subjectType: entry.subjectType,
      subjectId: entry.subjectId,
      event: entry.event,
      correlationId,
      metadata: entry.metadata ?? {},
    });
  };
}
