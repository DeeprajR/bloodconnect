/**
 * The email outbox: queue inside a transaction, drain outside it (§5.3, §7.6).
 *
 * The queue call takes the transaction handle, so the row commits with the
 * thing that caused it. The drain runs separately, with retries, and a message
 * that cannot be sent stays visible as a row rather than disappearing into a
 * log line.
 *
 * **Never put a secret in `payload`.** The link and the OTP are rendered into
 * the message body at send time from values passed here, which means the
 * token *does* pass through this table, and that is a deliberate, bounded
 * trade: an outbox that cannot reconstruct its message cannot retry it. The
 * mitigation is that these rows are short-lived by retention (§12.3) and every
 * token they carry is single-use and expires in hours.
 */

import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { emailDeliveries, type EmailKind } from '@blood-connect/db';
import { newId } from '@blood-connect/ids';

import type { Database, Transaction } from '../db.js';
import { TEMPLATE_VERSION, renderEmail, type EmailPort, type TemplateVars } from '../ports/email.js';

export type QueuedEmail = {
  readonly kind: EmailKind;
  readonly to: string;
  readonly userId: string | null;
  readonly vars: TemplateVars;
};

/** Committed with its cause, or not at all. */
export async function queueEmail(tx: Transaction, email: QueuedEmail): Promise<string> {
  const id = newId<'EmailDeliveryId'>();

  await tx.insert(emailDeliveries).values({
    id,
    userId: email.userId,
    kind: email.kind,
    toAddress: email.to,
    templateVersion: TEMPLATE_VERSION,
    status: 'queued',
    payload: email.vars,
  });

  return id;
}

/** Exponential, capped. A provider that is down does not want to be hammered. */
const backoffSeconds = (attempts: number): number =>
  Math.min(15 * 60, 30 * 2 ** Math.max(0, attempts - 1));

const MAX_ATTEMPTS = 6;

export type DrainResult = {
  readonly sent: number;
  readonly failed: number;
  readonly retrying: number;
};

/**
 * Sends what is due.
 *
 * Rows are claimed with `FOR UPDATE SKIP LOCKED` so two workers, or a worker
 * and a developer running the drain by hand, never send the same message
 * twice. Claiming and sending are deliberately *not* one transaction: holding a
 * row lock across a network call to a mail provider is how a slow provider
 * becomes a database problem.
 */
export async function drainEmailOutbox(
  db: Database,
  port: EmailPort,
  now: Date,
  limit = 20,
): Promise<DrainResult> {
  const due = await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: emailDeliveries.id,
        kind: emailDeliveries.kind,
        toAddress: emailDeliveries.toAddress,
        payload: emailDeliveries.payload,
        attempts: emailDeliveries.attempts,
      })
      .from(emailDeliveries)
      .where(
        and(eq(emailDeliveries.status, 'queued'), lte(emailDeliveries.nextAttemptAt, now)),
      )
      .limit(limit)
      .for('update', { skipLocked: true });

    if (rows.length > 0) {
      // Mark them taken inside the claim, so a second drain passes over them.
      await tx
        .update(emailDeliveries)
        .set({ attempts: sql`${emailDeliveries.attempts} + 1` })
        .where(
          inArray(
            emailDeliveries.id,
            rows.map((r) => r.id),
          ),
        );
    }

    return rows;
  });

  let sent = 0;
  let failed = 0;
  let retrying = 0;

  for (const row of due) {
    const message = renderEmail(
      row.kind as EmailKind,
      row.toAddress,
      (row.payload ?? {}) as TemplateVars,
    );

    const result = await port.send(message);

    if (result.ok) {
      await db
        .update(emailDeliveries)
        .set({
          status: 'sent',
          sentAt: now,
          providerMessageId: result.providerMessageId,
          lastError: null,
        })
        .where(eq(emailDeliveries.id, row.id));
      sent += 1;
      continue;
    }

    const attempts = row.attempts + 1;
    const giveUp = !result.retryable || attempts >= MAX_ATTEMPTS;

    await db
      .update(emailDeliveries)
      .set({
        status: giveUp ? 'failed' : 'queued',
        lastError: result.error.slice(0, 1000),
        nextAttemptAt: new Date(now.getTime() + backoffSeconds(attempts) * 1000),
      })
      .where(eq(emailDeliveries.id, row.id));

    if (giveUp) failed += 1;
    else retrying += 1;
  }

  return { sent, failed, retrying };
}

/**
 * The §11.9-style alert: anything queued and still unsent well past its due
 * time means the provider is down or the drain is not running. An invite
 * nobody received looks identical to an invite nobody used.
 */
export async function countStuckEmails(db: Database, olderThan: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(emailDeliveries)
    .where(and(eq(emailDeliveries.status, 'queued'), lte(emailDeliveries.createdAt, olderThan)));

  return row?.n ?? 0;
}
