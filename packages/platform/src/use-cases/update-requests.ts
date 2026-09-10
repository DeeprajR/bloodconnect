/**
 * The account update-request queue (§3, ADR 0011 §4).
 *
 * A doctor cannot silently rewrite the name and registration number that appear
 * on every request they raise, because those travel onto clinical records. They
 * ask, an administrator decides, and the system applies the change.
 *
 * **The system applies it, not the administrator.** An approval that only tells
 * an admin to go and retype the value somewhere else is an approval that can be
 * mistyped, and the queue would then hold a record of a change that never
 * happened. `approveUpdateRequest` writes the field itself, in the same
 * transaction as the decision.
 *
 * Email is not one of these fields. It has the stronger self-confirmation flow
 * in `account.ts`, and a second, weaker path to the same change is the path an
 * attacker would use.
 */

import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { err, ok, type Result } from '@blood-connect/result';
import {
  accountUpdateRequests,
  users,
  type UpdateRequestField,
  type UpdateRequestStatus,
} from '@blood-connect/db';

import type { UseCaseContext } from '../context.js';
import type { Transaction } from '../db.js';
import {
  notAuthorized,
  updateRequestRejected,
  type NotAuthorized,
  type UpdateRequestRejected,
} from '../errors.js';
import { createAuditWriter } from '../repositories/audit.js';

export type UpdateRequestError = NotAuthorized | UpdateRequestRejected;

/** What the person sees on their own profile, and what the admin queue lists. */
export type UpdateRequestRow = {
  readonly id: string;
  readonly userId: string;
  readonly field: UpdateRequestField;
  readonly currentValue: string | null;
  readonly proposedValue: string;
  readonly reason: string;
  readonly status: UpdateRequestStatus;
  readonly adminNote: string | null;
  readonly createdAt: Date;
  readonly decidedAt: Date | null;
};

/** The queue row, with the person it is about. */
export type PendingUpdateRequest = UpdateRequestRow & {
  readonly requesterName: string;
  readonly requesterEmail: string;
  readonly requesterRole: string;
  /**
   * Whole days since it was raised.
   *
   * This is the ⚠︎ of §8: an untouched request must age *visibly*, because the
   * failure being guarded against is not rejection but silence.
   */
  readonly ageDays: number;
};

export const UPDATE_REQUEST_LABELS: Record<UpdateRequestField, string> = {
  full_name: 'Full name',
  provisional_reg: 'Registration number',
};

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}

/* -------------------------------------------------------------------------- */
/* What the person does                                                        */
/* -------------------------------------------------------------------------- */

export async function requestAccountUpdate(
  ctx: UseCaseContext,
  input: { field: UpdateRequestField; proposedValue: string; reason: string },
): Promise<Result<{ id: string }, UpdateRequestError>> {
  if (ctx.actor.kind !== 'user') return err(notAuthorized('profile:manage'));

  const actorId = ctx.actor.userId;
  const now = ctx.clock.now();
  const proposedValue = input.proposedValue.trim();
  const reason = input.reason.trim();

  if (proposedValue.length === 0) return err(updateRequestRejected('empty_value'));
  if (reason.length === 0) return err(updateRequestRejected('no_reason'));

  return ctx.db.transaction(async (tx) => {
    const [account] = await tx
      .select({ fullName: users.fullName, provisionalReg: users.provisionalReg })
      .from(users)
      .where(eq(users.id, actorId));
    if (!account) return err(notAuthorized('profile:manage'));

    const currentValue =
      input.field === 'full_name' ? account.fullName : account.provisionalReg;
    if (currentValue === proposedValue) return err(updateRequestRejected('unchanged'));

    // Checked when the request is raised as well as when it is approved. Told
    // now, the person can go and sort it out; told only at approval, they hear
    // nothing for a day and then get a rejection they cannot act on.
    if (input.field === 'provisional_reg') {
      const taken = await regTakenBy(tx, proposedValue, actorId);
      if (taken) return err(updateRequestRejected('reg_taken'));
    }

    // Checked first so the ordinary case, the person forgot they already
    // asked, is a message rather than an aborted transaction.
    const [existing] = await tx
      .select({ id: accountUpdateRequests.id })
      .from(accountUpdateRequests)
      .where(
        and(
          eq(accountUpdateRequests.userId, actorId),
          eq(accountUpdateRequests.field, input.field),
          eq(accountUpdateRequests.status, 'pending'),
        ),
      );
    if (existing) return err(updateRequestRejected('already_pending'));

    const id = ctx.ids.next<'UpdateRequestId'>();
    try {
      await tx.insert(accountUpdateRequests).values({
        id,
        userId: actorId,
        field: input.field,
        currentValue,
        proposedValue,
        reason,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      });
    } catch (cause) {
      // And the partial unique index is the authority: two tabs open on the
      // profile page both pass the check above and both reach this insert.
      if (isOnePendingViolation(cause)) {
        return err(updateRequestRejected('already_pending'));
      }
      throw cause;
    }

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'account.update_requested',
      subjectType: 'account_update_request',
      subjectId: id,
      // The field, not the value: §11.9 keeps identifying data out of the log,
      // and the row itself holds what was proposed.
      metadata: { field: input.field },
    });

    return ok({ id });
  });
}

export async function withdrawAccountUpdate(
  ctx: UseCaseContext,
  requestId: string,
): Promise<Result<Record<string, never>, UpdateRequestError>> {
  if (ctx.actor.kind !== 'user') return err(notAuthorized('profile:manage'));

  const actorId = ctx.actor.userId;
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    // A conditional UPDATE rather than read-then-write: an administrator may be
    // deciding it on another connection, and whichever statement lands first
    // wins cleanly instead of both believing they succeeded.
    const changed = await tx
      .update(accountUpdateRequests)
      .set({ status: 'withdrawn', updatedAt: now })
      .where(
        and(
          eq(accountUpdateRequests.id, requestId),
          eq(accountUpdateRequests.userId, actorId),
          eq(accountUpdateRequests.status, 'pending'),
        ),
      )
      .returning({ id: accountUpdateRequests.id });

    if (changed.length === 0) return err(updateRequestRejected('already_decided'));

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'account.update_withdrawn',
      subjectType: 'account_update_request',
      subjectId: requestId,
    });

    return ok({});
  });
}

export async function listMyUpdateRequests(
  ctx: UseCaseContext,
  limit = 10,
): Promise<readonly UpdateRequestRow[]> {
  if (ctx.actor.kind !== 'user') return [];

  const rows = await ctx.db
    .select()
    .from(accountUpdateRequests)
    .where(eq(accountUpdateRequests.userId, ctx.actor.userId))
    .orderBy(desc(accountUpdateRequests.createdAt))
    .limit(limit);

  return rows.map(toRow);
}

/* -------------------------------------------------------------------------- */
/* What the administrator does                                                 */
/* -------------------------------------------------------------------------- */

export async function listPendingUpdateRequests(
  ctx: UseCaseContext,
): Promise<readonly PendingUpdateRequest[]> {
  const now = ctx.clock.now();

  const rows = await ctx.db
    .select({
      request: accountUpdateRequests,
      requesterName: users.fullName,
      requesterEmail: users.email,
      requesterRole: users.role,
    })
    .from(accountUpdateRequests)
    .innerJoin(users, eq(users.id, accountUpdateRequests.userId))
    .where(eq(accountUpdateRequests.status, 'pending'))
    // Oldest first. The ageing is the point, and a queue sorted newest-first
    // buries exactly the request that has been waiting longest.
    .orderBy(asc(accountUpdateRequests.createdAt));

  return rows.map((row) => ({
    ...toRow(row.request),
    requesterName: row.requesterName,
    requesterEmail: row.requesterEmail,
    requesterRole: row.requesterRole,
    ageDays: daysBetween(row.request.createdAt, now),
  }));
}

export async function approveUpdateRequest(
  ctx: UseCaseContext,
  requestId: string,
): Promise<Result<{ field: UpdateRequestField }, UpdateRequestError>> {
  if (ctx.actor.kind !== 'user') return err(notAuthorized('doctors:manage'));

  const adminId = ctx.actor.userId;
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const [pending] = await tx
      .select()
      .from(accountUpdateRequests)
      .where(eq(accountUpdateRequests.id, requestId))
      .for('update');

    if (!pending) return err(updateRequestRejected('not_found'));
    if (pending.status !== 'pending') return err(updateRequestRejected('already_decided'));
    // §3's safeguard. Held here rather than in the database, which sees two
    // uuids and cannot know that one of them is the whole point.
    if (pending.userId === adminId) return err(updateRequestRejected('own_request'));

    const field = pending.field as UpdateRequestField;

    if (field === 'provisional_reg') {
      const taken = await regTakenBy(tx, pending.proposedValue, pending.userId);
      if (taken) return err(updateRequestRejected('reg_taken'));
    }

    // The system applies it. An admin retyping the value is a second chance to
    // get it wrong, against a queue that would say it went right.
    await tx
      .update(users)
      .set(
        field === 'full_name'
          ? { fullName: pending.proposedValue, updatedAt: now }
          : { provisionalReg: pending.proposedValue, updatedAt: now },
      )
      .where(eq(users.id, pending.userId));

    await tx
      .update(accountUpdateRequests)
      .set({ status: 'approved', decidedBy: adminId, decidedAt: now, updatedAt: now })
      .where(eq(accountUpdateRequests.id, requestId));

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'account.update_approved',
      subjectType: 'account_update_request',
      subjectId: requestId,
      metadata: { field, userId: pending.userId },
    });

    return ok({ field });
  });
}

export async function rejectUpdateRequest(
  ctx: UseCaseContext,
  requestId: string,
  adminNote: string,
): Promise<Result<Record<string, never>, UpdateRequestError>> {
  if (ctx.actor.kind !== 'user') return err(notAuthorized('doctors:manage'));

  const adminId = ctx.actor.userId;
  const now = ctx.clock.now();
  const note = adminNote.trim();

  // §8: a rejection the person cannot act on is not an ending, it is a dead
  // end. The note is what turns one into the other.
  if (note.length === 0) return err(updateRequestRejected('no_reason'));

  return ctx.db.transaction(async (tx) => {
    const [pending] = await tx
      .select({
        userId: accountUpdateRequests.userId,
        status: accountUpdateRequests.status,
      })
      .from(accountUpdateRequests)
      .where(eq(accountUpdateRequests.id, requestId))
      .for('update');

    if (!pending) return err(updateRequestRejected('not_found'));
    if (pending.status !== 'pending') return err(updateRequestRejected('already_decided'));
    if (pending.userId === adminId) return err(updateRequestRejected('own_request'));

    await tx
      .update(accountUpdateRequests)
      .set({
        status: 'rejected',
        adminNote: note,
        decidedBy: adminId,
        decidedAt: now,
        updatedAt: now,
      })
      .where(eq(accountUpdateRequests.id, requestId));

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'account.update_rejected',
      subjectType: 'account_update_request',
      subjectId: requestId,
      metadata: { userId: pending.userId },
    });

    return ok({});
  });
}

/* -------------------------------------------------------------------------- */

async function regTakenBy(
  tx: Transaction,
  value: string,
  exceptUserId: string,
): Promise<boolean> {
  const clash = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.provisionalReg, value), ne(users.id, exceptUserId)));
  return clash.length > 0;
}

/**
 * Drizzle wraps the driver error, so the constraint name is one or two `cause`
 * links down rather than on the error itself.
 */
function isOnePendingViolation(thrown: unknown): boolean {
  let cause: unknown = thrown;
  for (let depth = 0; depth < 4 && typeof cause === 'object' && cause !== null; depth += 1) {
    if (
      'constraint_name' in cause &&
      cause.constraint_name === 'account_update_requests_one_pending_idx'
    ) {
      return true;
    }
    cause = 'cause' in cause ? cause.cause : null;
  }
  return false;
}

function toRow(row: typeof accountUpdateRequests.$inferSelect): UpdateRequestRow {
  return {
    id: row.id,
    userId: row.userId,
    field: row.field as UpdateRequestField,
    currentValue: row.currentValue,
    proposedValue: row.proposedValue,
    reason: row.reason,
    status: row.status as UpdateRequestStatus,
    adminNote: row.adminNote,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
  };
}
