/**
 * Doctor records, managed by an administrator (§2.3, §8.1).
 *
 * The administration application owns exactly this: a doctor's name,
 * registration number, seal and address. It creates the account and it never
 * knows a password, because at the moment it creates one none exists. The
 * person sets theirs from a link sent to their inbox.
 *
 * Every use case here opens one transaction, asserts its own permission, and
 * queues any email in the same transaction as the change that caused it.
 */

import { and, count, desc, eq, ne } from 'drizzle-orm';
import { err, ok, type Result } from '@blood-connect/result';
import { objectRefs, userSeals, users, type UserStatus } from '@blood-connect/db';

import type { UseCaseContext } from '../context.js';
import { actorHas } from '../domain/authorization.js';
import { isPlausibleEmail, normaliseEmail } from '../domain/credentials.js';
import {
  accountNotFound,
  emailTaken,
  lastAdministrator,
  linkNotUsable,
  notAuthorized,
  type AccountNotFound,
  type EmailTaken,
  type LastAdministrator,
  type LinkNotUsable,
  type NotAuthorized,
} from '../errors.js';
import { findAccountById, revokeAllSessionsForUser } from '../repositories/accounts.js';
import { createAuditWriter } from '../repositories/audit.js';
import { queueEmail } from '../repositories/email-outbox.js';
import { createInvite, supersedeLiveInvites } from '../repositories/lifecycle.js';

/** An empty registration number means "not recorded", not an empty string. */
const blankToNull = (value: string | null): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

/** Where the doctor sets their password. The admin app is a different origin. */
const staffAppUrl = (): string =>
  process.env['STAFF_APP_URL']?.replace(/\/+$/, '') ?? 'http://localhost:3000';

export type DoctorSummary = {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly provisionalReg: string | null;
  readonly status: UserStatus;
  readonly lastLoginAt: Date | null;
  readonly createdAt: Date;
  readonly hasSeal: boolean;
};

/* -------------------------------------------------------------------------- */
/* Create                                                                      */
/* -------------------------------------------------------------------------- */

export type CreateDoctorInput = {
  readonly fullName: string;
  readonly email: string;
  readonly provisionalReg: string | null;
};

export type CreateDoctorError = NotAuthorized | EmailTaken;

/**
 * Creates the account and queues its invite in one transaction.
 *
 * The two must commit together. An account created whose invite was never
 * queued is an account nobody can sign in to and nobody was told about, and it
 * looks exactly like an invite the doctor ignored, which is the failure §8
 * asks every flow to make impossible.
 */
export async function createDoctor(
  ctx: UseCaseContext,
  input: CreateDoctorInput,
): Promise<Result<{ userId: string }, CreateDoctorError>> {
  if (!actorHas(ctx.actor, 'doctors:manage')) return err(notAuthorized('doctors:manage'));

  const now = ctx.clock.now();
  const email = normaliseEmail(input.email);
  if (!isPlausibleEmail(email)) return err(emailTaken());

  return ctx.db.transaction(async (tx) => {
    const existing = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existing.length > 0) return err(emailTaken());

    const userId = ctx.ids.next<'UserId'>();

    await tx.insert(users).values({
      id: userId,
      email,
      fullName: input.fullName.trim(),
      role: 'doctor',
      provisionalReg: blankToNull(input.provisionalReg),
      // No password field exists here, and the administrator never knows one.
      status: 'pending_activation',
      passwordHash: null,
    });

    await issueInvite(ctx, tx, {
      userId,
      email,
      fullName: input.fullName.trim(),
      now,
      kind: 'invite',
    });

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'account.created',
      subjectType: 'user',
      subjectId: userId,
      metadata: { role: 'doctor', email },
    });

    return ok({ userId });
  });
}

/** Shared by creation and re-send: supersede, insert, queue. */
async function issueInvite(
  ctx: UseCaseContext,
  tx: Parameters<typeof supersedeLiveInvites>[0],
  args: {
    userId: string;
    email: string;
    fullName: string;
    now: Date;
    kind: 'invite' | 'invite_resent';
  },
): Promise<void> {
  const ttlHours = ctx.config.auth.inviteTtlHours;
  const token = ctx.ports.tokens.issue();

  // Supersede first: the partial unique index permits one live invite per
  // account, so a re-send must kill the previous one before inserting.
  await supersedeLiveInvites(tx, args.userId, args.now);

  await createInvite(tx, {
    id: ctx.ids.next<'InviteId'>(),
    userId: args.userId,
    tokenHash: ctx.ports.tokens.fingerprint(token),
    expiresAt: new Date(args.now.getTime() + ttlHours * 3_600_000),
    sentBy: ctx.actor.kind === 'user' ? ctx.actor.userId : null,
  });

  await queueEmail(tx, {
    kind: args.kind,
    to: args.email,
    userId: args.userId,
    vars: {
      fullName: args.fullName,
      link: `${staffAppUrl()}/invite/${token}`,
      expiresInHours: String(ttlHours),
    },
  });
}

export async function resendInvite(
  ctx: UseCaseContext,
  userId: string,
): Promise<Result<Record<string, never>, NotAuthorized | AccountNotFound | LinkNotUsable>> {
  if (!actorHas(ctx.actor, 'doctors:manage')) return err(notAuthorized('doctors:manage'));

  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const account = await findAccountById(tx, userId);
    if (!account) return err(accountNotFound());

    // Re-sending to an account that is already using the system would issue a
    // password-setting link to someone who has a password. An account
    // takeover primitive handed to whoever can read that inbox.
    if (account.status !== 'pending_activation') return err(linkNotUsable());

    await issueInvite(ctx, tx, {
      userId,
      email: account.email,
      fullName: account.fullName,
      now,
      kind: 'invite_resent',
    });

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({ action: 'account.invite_resent', subjectType: 'user', subjectId: userId });

    return ok({});
  });
}

/* -------------------------------------------------------------------------- */
/* Update                                                                      */
/* -------------------------------------------------------------------------- */

export type UpdateDoctorInput = {
  readonly fullName: string;
  readonly provisionalReg: string | null;
};

export async function updateDoctor(
  ctx: UseCaseContext,
  userId: string,
  input: UpdateDoctorInput,
): Promise<Result<Record<string, never>, NotAuthorized | AccountNotFound>> {
  if (!actorHas(ctx.actor, 'doctors:manage')) return err(notAuthorized('doctors:manage'));

  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const before = await findAccountById(tx, userId);
    if (!before) return err(accountNotFound());

    const fullName = input.fullName.trim();
    const provisionalReg = blankToNull(input.provisionalReg);

    await tx.update(users).set({ fullName, provisionalReg }).where(eq(users.id, userId));

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    // Old and new both recorded: "what did it used to say" is the question an
    // audit log is read to answer (§14).
    await audit({
      action: 'account.details_changed',
      subjectType: 'user',
      subjectId: userId,
      metadata: {
        fullName: { from: before.fullName, to: fullName },
        provisionalReg: { from: before.provisionalReg, to: provisionalReg },
      },
    });

    return ok({});
  });
}

/**
 * An administrator setting a doctor's address directly.
 *
 * Both addresses are told, because this is the one change that can quietly move
 * an account to someone else's inbox, and the person losing it must hear about
 * it at the address they still read.
 */
export async function setDoctorEmail(
  ctx: UseCaseContext,
  userId: string,
  newEmailInput: string,
): Promise<Result<Record<string, never>, NotAuthorized | AccountNotFound | EmailTaken>> {
  if (!actorHas(ctx.actor, 'doctors:manage')) return err(notAuthorized('doctors:manage'));

  const now = ctx.clock.now();
  const newEmail = normaliseEmail(newEmailInput);
  if (!isPlausibleEmail(newEmail)) return err(emailTaken());

  return ctx.db.transaction(async (tx) => {
    const before = await findAccountById(tx, userId);
    if (!before) return err(accountNotFound());
    if (before.email.toLowerCase() === newEmail) return ok({});

    const clash = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, newEmail), ne(users.id, userId)));
    if (clash.length > 0) return err(emailTaken());

    await tx.update(users).set({ email: newEmail }).where(eq(users.id, userId));

    // Any live confirmation for a change the doctor started is now stale.
    await queueEmail(tx, {
      kind: 'email_change_notice',
      to: before.email,
      userId,
      vars: { fullName: before.fullName, newEmail },
    });

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'account.email_changed',
      subjectType: 'user',
      subjectId: userId,
      metadata: { from: before.email, to: newEmail, by: 'administrator' },
    });

    return ok({});
  });
}

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

export async function setAccountStatus(
  ctx: UseCaseContext,
  userId: string,
  status: Extract<UserStatus, 'active' | 'deactivated'>,
): Promise<
  Result<Record<string, never>, NotAuthorized | AccountNotFound | LastAdministrator>
> {
  if (!actorHas(ctx.actor, 'doctors:manage')) return err(notAuthorized('doctors:manage'));

  // Nobody deactivates their own account (§13). Not a courtesy. It is what
  // stops an administrator locking themselves out of the only way back in.
  if (ctx.actor.kind === 'user' && ctx.actor.userId === userId) {
    return err(notAuthorized('doctors:manage'));
  }

  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const account = await findAccountById(tx, userId);
    if (!account) return err(accountNotFound());
    if (account.status === status) return ok({});

    if (status === 'deactivated' && account.role === 'admin') {
      // Row-locked count, so two concurrent demotions cannot both pass (§13).
      const [remaining] = await tx
        .select({ n: count() })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.status, 'active'), ne(users.id, userId)))
        .for('update');

      if ((remaining?.n ?? 0) === 0) return err(lastAdministrator());
    }

    // An account that never activated has no password, and the CHECK
    // constraint ties that to `pending_activation`, so reactivating one puts
    // it back where it was rather than into an impossible state.
    const nextStatus =
      status === 'active' && account.passwordHash === null ? 'pending_activation' : status;

    await tx.update(users).set({ status: nextStatus }).where(eq(users.id, userId));

    if (nextStatus === 'deactivated') {
      // Deactivating ends the sessions, which is what the word means to whoever
      // clicked it.
      await revokeAllSessionsForUser(tx, userId, now);
      await queueEmail(tx, {
        kind: 'account_deactivated',
        to: account.email,
        userId,
        vars: { fullName: account.fullName },
      });
    }

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'account.status_changed',
      subjectType: 'user',
      subjectId: userId,
      metadata: { from: account.status, to: nextStatus },
    });

    return ok({});
  });
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listDoctors(ctx: UseCaseContext): Promise<DoctorSummary[]> {
  const rows = await ctx.db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      provisionalReg: users.provisionalReg,
      status: users.status,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      sealId: userSeals.objectRefId,
    })
    .from(users)
    .leftJoin(userSeals, eq(userSeals.userId, users.id))
    .where(eq(users.role, 'doctor'))
    .orderBy(desc(users.createdAt));

  return rows.map((row) => ({
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    provisionalReg: row.provisionalReg,
    status: row.status as UserStatus,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
    hasSeal: row.sealId !== null,
  }));
}

export type DoctorDetail = DoctorSummary & {
  readonly sealObjectId: string | null;
  readonly sealContentType: string | null;
};

export async function getDoctor(
  ctx: UseCaseContext,
  userId: string,
): Promise<DoctorDetail | undefined> {
  const [row] = await ctx.db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      provisionalReg: users.provisionalReg,
      status: users.status,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      role: users.role,
      sealObjectId: objectRefs.id,
      sealContentType: objectRefs.contentType,
    })
    .from(users)
    .leftJoin(userSeals, eq(userSeals.userId, users.id))
    .leftJoin(objectRefs, eq(objectRefs.id, userSeals.objectRefId))
    .where(and(eq(users.id, userId), eq(users.role, 'doctor')));

  if (!row) return undefined;

  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    provisionalReg: row.provisionalReg,
    status: row.status as UserStatus,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
    hasSeal: row.sealObjectId !== null,
    sealObjectId: row.sealObjectId,
    sealContentType: row.sealContentType,
  };
}
