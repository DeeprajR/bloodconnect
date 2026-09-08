/**
 * The audit writer (§2.9, §14).
 *
 * Wired into the use-case context so every later phase gets it for free: a use
 * case calls `writeAudit` on the same transaction handle it is already using,
 * so the record and the thing it records commit together or not at all. An
 * audit row written after the commit is a row that can go missing exactly when
 * it matters.
 *
 * The table is append-only by grant, not by convention — `app_web` holds no
 * UPDATE or DELETE on it (migration 0004).
 */

import { auditLog } from '@blood-connect/db';
import { newId } from '@blood-connect/ids';

import type { Transaction } from '../db.js';
import type { Actor } from '../domain/authorization.js';

export type AuditEntry = {
  /** Past tense, dotted: `session.created`, `account.role_changed`. */
  readonly action: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly metadata?: Record<string, unknown>;
};

export type AuditWriter = (entry: AuditEntry) => Promise<void>;

/**
 * Metadata is for what a reader would need to understand the row later — never
 * a password, a token, an OTP or a session value. The audit log outlives the
 * incident it documents, and a secret in it is a secret with a long tail.
 */
export function createAuditWriter(
  tx: Transaction,
  actor: Actor,
  correlationId: string,
  occurredAt: Date,
): AuditWriter {
  return async (entry: AuditEntry): Promise<void> => {
    await tx.insert(auditLog).values({
      id: newId(),
      occurredAt,
      actorUserId: actor.kind === 'user' ? actor.userId : null,
      actorKind: actor.kind === 'anonymous' ? 'system' : actor.kind,
      action: entry.action,
      subjectType: entry.subjectType,
      subjectId: entry.subjectId,
      correlationId,
      metadata: entry.metadata ?? {},
    });
  };
}
