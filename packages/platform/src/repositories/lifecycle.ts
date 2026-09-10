/**
 * The three single-use-secret tables: invites, reset codes, address changes.
 *
 * They share a shape on purpose (see the schema), so they share these helpers.
 * Every "supersede" is an UPDATE that runs *before* the new row is inserted,
 * because the partial unique index allows exactly one live row per user. The
 * database is what enforces "only one link works", not the order these calls
 * happen to be written in.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  accountInvites,
  emailChangeRequests,
  passwordResetOtps,
} from '@blood-connect/db';

import type { Transaction } from '../db.js';

/* -------------------------------------------------------------------------- */
/* Invites                                                                     */
/* -------------------------------------------------------------------------- */

export async function supersedeLiveInvites(
  tx: Transaction,
  userId: string,
  at: Date,
): Promise<void> {
  await tx
    .update(accountInvites)
    .set({ supersededAt: at })
    .where(
      and(
        eq(accountInvites.userId, userId),
        isNull(accountInvites.consumedAt),
        isNull(accountInvites.supersededAt),
      ),
    );
}

export async function createInvite(
  tx: Transaction,
  row: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    sentBy: string | null;
  },
): Promise<void> {
  await tx.insert(accountInvites).values(row);
}

export type InviteRow = {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly supersededAt: Date | null;
};

export async function findInviteByToken(
  tx: Transaction,
  tokenHash: string,
): Promise<InviteRow | undefined> {
  const [row] = await tx
    .select({
      id: accountInvites.id,
      userId: accountInvites.userId,
      expiresAt: accountInvites.expiresAt,
      consumedAt: accountInvites.consumedAt,
      supersededAt: accountInvites.supersededAt,
    })
    .from(accountInvites)
    .where(eq(accountInvites.tokenHash, tokenHash));

  return row;
}

/**
 * Consuming is a conditional UPDATE reporting whether it actually moved (§7.4).
 *
 * Two tabs opening the same invite link at once must not both set a password:
 * exactly one UPDATE matches, and the loser is told the link is spent.
 */
export async function consumeInviteRow(
  tx: Transaction,
  id: string,
  at: Date,
): Promise<boolean> {
  const rows = await tx
    .update(accountInvites)
    .set({ consumedAt: at })
    .where(and(eq(accountInvites.id, id), isNull(accountInvites.consumedAt)))
    .returning({ id: accountInvites.id });

  return rows.length === 1;
}

/* -------------------------------------------------------------------------- */
/* Password reset codes                                                        */
/* -------------------------------------------------------------------------- */

export async function supersedeLiveOtps(
  tx: Transaction,
  userId: string,
  at: Date,
): Promise<void> {
  await tx
    .update(passwordResetOtps)
    .set({ supersededAt: at })
    .where(
      and(
        eq(passwordResetOtps.userId, userId),
        isNull(passwordResetOtps.consumedAt),
        isNull(passwordResetOtps.supersededAt),
      ),
    );
}

export async function createOtp(
  tx: Transaction,
  row: { id: string; userId: string; otpHash: string; expiresAt: Date },
): Promise<void> {
  await tx.insert(passwordResetOtps).values(row);
}

export type OtpRow = {
  readonly id: string;
  readonly userId: string;
  readonly otpHash: string;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly supersededAt: Date | null;
  readonly attempts: number;
};

export async function findLiveOtpForUser(
  tx: Transaction,
  userId: string,
): Promise<OtpRow | undefined> {
  const [row] = await tx
    .select()
    .from(passwordResetOtps)
    .where(
      and(
        eq(passwordResetOtps.userId, userId),
        isNull(passwordResetOtps.consumedAt),
        isNull(passwordResetOtps.supersededAt),
      ),
    );

  return row;
}

/** A wrong guess costs an attempt, whether or not the code was close. */
export async function recordOtpAttempt(tx: Transaction, id: string): Promise<number> {
  const [row] = await tx
    .update(passwordResetOtps)
    .set({ attempts: sql`${passwordResetOtps.attempts} + 1` })
    .where(eq(passwordResetOtps.id, id))
    .returning({ attempts: passwordResetOtps.attempts });

  return row?.attempts ?? 0;
}

export async function consumeOtp(tx: Transaction, id: string, at: Date): Promise<boolean> {
  const rows = await tx
    .update(passwordResetOtps)
    .set({ consumedAt: at })
    .where(and(eq(passwordResetOtps.id, id), isNull(passwordResetOtps.consumedAt)))
    .returning({ id: passwordResetOtps.id });

  return rows.length === 1;
}

/* -------------------------------------------------------------------------- */
/* Address changes                                                             */
/* -------------------------------------------------------------------------- */

export async function supersedeLiveEmailChanges(
  tx: Transaction,
  userId: string,
  at: Date,
): Promise<void> {
  await tx
    .update(emailChangeRequests)
    .set({ supersededAt: at })
    .where(
      and(
        eq(emailChangeRequests.userId, userId),
        isNull(emailChangeRequests.consumedAt),
        isNull(emailChangeRequests.supersededAt),
        isNull(emailChangeRequests.cancelledAt),
      ),
    );
}

export async function createEmailChange(
  tx: Transaction,
  row: {
    id: string;
    userId: string;
    currentEmail: string;
    newEmail: string;
    tokenHash: string;
    expiresAt: Date;
  },
): Promise<void> {
  await tx.insert(emailChangeRequests).values(row);
}

export type EmailChangeRow = {
  readonly id: string;
  readonly userId: string;
  readonly currentEmail: string;
  readonly newEmail: string;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly supersededAt: Date | null;
  readonly cancelledAt: Date | null;
};

export async function findEmailChangeByToken(
  tx: Transaction,
  tokenHash: string,
): Promise<EmailChangeRow | undefined> {
  const [row] = await tx
    .select({
      id: emailChangeRequests.id,
      userId: emailChangeRequests.userId,
      currentEmail: emailChangeRequests.currentEmail,
      newEmail: emailChangeRequests.newEmail,
      expiresAt: emailChangeRequests.expiresAt,
      consumedAt: emailChangeRequests.consumedAt,
      supersededAt: emailChangeRequests.supersededAt,
      cancelledAt: emailChangeRequests.cancelledAt,
    })
    .from(emailChangeRequests)
    .where(eq(emailChangeRequests.tokenHash, tokenHash));

  return row;
}

export async function findLiveEmailChangeForUser(
  tx: Transaction,
  userId: string,
): Promise<EmailChangeRow | undefined> {
  const [row] = await tx
    .select({
      id: emailChangeRequests.id,
      userId: emailChangeRequests.userId,
      currentEmail: emailChangeRequests.currentEmail,
      newEmail: emailChangeRequests.newEmail,
      expiresAt: emailChangeRequests.expiresAt,
      consumedAt: emailChangeRequests.consumedAt,
      supersededAt: emailChangeRequests.supersededAt,
      cancelledAt: emailChangeRequests.cancelledAt,
    })
    .from(emailChangeRequests)
    .where(
      and(
        eq(emailChangeRequests.userId, userId),
        isNull(emailChangeRequests.consumedAt),
        isNull(emailChangeRequests.supersededAt),
        isNull(emailChangeRequests.cancelledAt),
      ),
    );

  return row;
}

export async function consumeEmailChange(
  tx: Transaction,
  id: string,
  at: Date,
): Promise<boolean> {
  const rows = await tx
    .update(emailChangeRequests)
    .set({ consumedAt: at })
    .where(and(eq(emailChangeRequests.id, id), isNull(emailChangeRequests.consumedAt)))
    .returning({ id: emailChangeRequests.id });

  return rows.length === 1;
}

export async function cancelEmailChange(
  tx: Transaction,
  userId: string,
  at: Date,
): Promise<void> {
  await tx
    .update(emailChangeRequests)
    .set({ cancelledAt: at })
    .where(
      and(
        eq(emailChangeRequests.userId, userId),
        isNull(emailChangeRequests.consumedAt),
        isNull(emailChangeRequests.cancelledAt),
      ),
    );
}
