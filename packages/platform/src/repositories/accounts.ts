/**
 * Reads and writes over `users` and `sessions`.
 *
 * Repositories map rows to types and nothing else: no rule lives here, and none
 * of them opens a transaction. The use case owns that (§3).
 */

import { and, eq, gt, isNull, ne } from 'drizzle-orm';
import { sessions, users, type UserRole, type UserStatus } from '@blood-connect/db';

import type { Database, Transaction } from '../db.js';

export type AccountRow = {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly passwordHash: string | null;
  readonly provisionalReg: string | null;
  readonly districtScopeId: string | null;
};

const accountColumns = {
  id: users.id,
  email: users.email,
  fullName: users.fullName,
  role: users.role,
  status: users.status,
  passwordHash: users.passwordHash,
  provisionalReg: users.provisionalReg,
  districtScopeId: users.districtScopeId,
} as const;

export async function findAccountByEmail(
  tx: Transaction | Database,
  email: string,
): Promise<AccountRow | undefined> {
  // `email` is citext, so this comparison is case-insensitive in the column
  // type rather than at the call site (§5.3).
  const [row] = await tx.select(accountColumns).from(users).where(eq(users.email, email));
  return row as AccountRow | undefined;
}

export async function findAccountById(
  tx: Transaction | Database,
  id: string,
): Promise<AccountRow | undefined> {
  const [row] = await tx.select(accountColumns).from(users).where(eq(users.id, id));
  return row as AccountRow | undefined;
}

export async function touchLastLogin(
  tx: Transaction,
  userId: string,
  at: Date,
): Promise<void> {
  await tx.update(users).set({ lastLoginAt: at }).where(eq(users.id, userId));
}

export async function setPasswordHash(
  tx: Transaction,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

export type SessionRow = {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: Date;
};

/** Which application a session belongs to (§1). */
export type Audience = 'staff' | 'admin';

export async function createSession(
  tx: Transaction,
  row: {
    id: string;
    userId: string;
    tokenHash: string;
    audience: Audience;
    expiresAt: Date;
    ip: string | null;
    userAgent: string | null;
  },
): Promise<void> {
  await tx.insert(sessions).values(row);
}

export type AuthenticatedSession = {
  readonly session: SessionRow;
  readonly account: AccountRow;
};

/**
 * Resolves a cookie to a principal in one query.
 *
 * Every condition is in the WHERE clause rather than checked afterwards: a
 * revoked session, an expired one and one belonging to a deactivated account
 * are all simply *not found*, so there is no branch where a caller forgets one
 * of the three. Deactivating an account ends its sessions immediately, which is
 * what an admin expects "deactivate" to mean.
 */
export async function findLiveSession(
  tx: Transaction | Database,
  tokenHash: string,
  now: Date,
  audience: Audience,
): Promise<AuthenticatedSession | undefined> {
  const [row] = await tx
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
      ...accountColumns,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        // A typed operator, not a raw template: the driver needs the column's
        // type to bind a Date as a timestamptz, and an untyped parameter is
        // rejected at the socket rather than at compile time.
        gt(sessions.expiresAt, now),
        // The staff app and the admin app share a host in development, where
        // cookies are not isolated by port. A session is only valid for the
        // application that issued it.
        eq(sessions.audience, audience),
        eq(users.status, 'active'),
      ),
    );

  if (!row) return undefined;

  return {
    session: { id: row.sessionId, userId: row.userId, expiresAt: row.expiresAt },
    account: {
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      role: row.role as UserRole,
      status: row.status as UserStatus,
      passwordHash: row.passwordHash,
      provisionalReg: row.provisionalReg,
      districtScopeId: row.districtScopeId,
    },
  };
}

export async function revokeSession(
  tx: Transaction,
  tokenHash: string,
  at: Date,
): Promise<string | undefined> {
  const [row] = await tx
    .update(sessions)
    .set({ revokedAt: at })
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });

  return row?.id;
}

/** A password reset revokes every session for the account (§3). */
export async function revokeAllSessionsForUser(
  tx: Transaction,
  userId: string,
  at: Date,
  except?: string,
): Promise<number> {
  const rows = await tx
    .update(sessions)
    .set({ revokedAt: at })
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        ...(except ? [ne(sessions.id, except)] : []),
      ),
    )
    .returning({ id: sessions.id });

  return rows.length;
}
