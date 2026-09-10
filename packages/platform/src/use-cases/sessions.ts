/**
 * Ending a session, and resolving one (§3, §8.1).
 */

import { ok, okVoid, type Result } from '@blood-connect/result';

import type { Database } from '../db.js';
import type { UseCaseContext } from '../context.js';
import type { Actor } from '../domain/authorization.js';
import {
  findLiveSession,
  revokeAllSessionsForUser,
  revokeSession,
  type Audience,
} from '../repositories/accounts.js';
import { createAuditWriter } from '../repositories/audit.js';

/**
 * Turns a cookie value into a principal, or into nothing.
 *
 * Not a use case: it opens no transaction and changes nothing, and it runs on
 * every request including the ones that render a public page. It is the only
 * place a token becomes an actor, so the three authorization layers all get
 * their actor from here and cannot disagree about who is signed in.
 */
export async function resolveActor(
  db: Database,
  tokenHash: string | undefined,
  now: Date,
  audience: Audience = 'staff',
): Promise<Actor> {
  if (!tokenHash) return { kind: 'anonymous' };

  const found = await findLiveSession(db, tokenHash, now, audience);
  if (!found) return { kind: 'anonymous' };

  return {
    kind: 'user',
    userId: found.account.id,
    role: found.account.role,
    districtScopeId: found.account.districtScopeId,
  };
}

/**
 * Signing out is idempotent: a second call, a double-click or a replayed form
 * post all end with the session revoked and nothing thrown. The conditional
 * UPDATE reports whether it actually moved, so the audit row is written only
 * for the call that did the work (§7.4).
 */
export async function signOut(
  ctx: UseCaseContext,
  tokenHash: string,
): Promise<Result<{ revoked: boolean }, never>> {
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const revokedId = await revokeSession(tx, tokenHash, now);
    if (revokedId === undefined) return ok({ revoked: false });

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'session.revoked',
      subjectType: 'session',
      subjectId: revokedId,
      metadata: { reason: 'sign_out' },
    });

    return ok({ revoked: true });
  });
}

/**
 * Ends every session for an account.
 *
 * Called by the password reset and the password change (§3), and by an admin
 * deactivating an account. `except` keeps the caller's own session alive when
 * they are changing their own password. Signing someone out of the tab they
 * are working in is a punishment for doing the right thing.
 */
export async function revokeAllSessions(
  ctx: UseCaseContext,
  userId: string,
  reason: string,
  exceptSessionId?: string,
): Promise<Result<{ revokedCount: number }, never>> {
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const revokedCount = await revokeAllSessionsForUser(tx, userId, now, exceptSessionId);

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'session.revoked_all',
      subjectType: 'user',
      subjectId: userId,
      metadata: { reason, revokedCount },
    });

    return ok({ revokedCount });
  });
}

export { okVoid };
