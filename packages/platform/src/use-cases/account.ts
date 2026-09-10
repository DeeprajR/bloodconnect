/**
 * What a doctor does with their own account (§3, §8.1).
 *
 * Activation from an invite, password reset by one-time code, and changing the
 * address. Confirmed by the person holding the new inbox rather than by an
 * administrator. A link delivered to the proposed address proves they hold it;
 * an approval queue only proves someone agreed.
 *
 * Every flow here ends somewhere named, including when it goes wrong, and
 * whoever was left waiting is told (§8).
 */

import { eq } from 'drizzle-orm';
import { err, ok, type Result } from '@blood-connect/result';
import { users, type UserRole } from '@blood-connect/db';

import type { UseCaseContext } from '../context.js';
import { audienceFor } from '../domain/authorization.js';
import {
  checkPassword,
  isLinkUsable,
  isOtpUsable,
  isPlausibleEmail,
  normaliseEmail,
} from '../domain/credentials.js';
import {
  emailTaken,
  linkNotUsable,
  notAuthorized,
  otpNotAccepted,
  passwordTooShort,
  rateLimited,
  type EmailTaken,
  type LinkNotUsable,
  type NotAuthorized,
  type OtpNotAccepted,
  type PasswordRejected,
  type RateLimited,
} from '../errors.js';
import {
  createSession,
  findAccountById,
  findAccountByEmail,
  revokeAllSessionsForUser,
  setPasswordHash,
  touchLastLogin,
} from '../repositories/accounts.js';
import { createAuditWriter } from '../repositories/audit.js';
import { queueEmail } from '../repositories/email-outbox.js';
import {
  cancelEmailChange,
  consumeEmailChange,
  consumeInviteRow,
  consumeOtp,
  createEmailChange,
  createOtp,
  findEmailChangeByToken,
  findInviteByToken,
  findLiveOtpForUser,
  recordOtpAttempt,
  supersedeLiveEmailChanges,
  supersedeLiveOtps,
} from '../repositories/lifecycle.js';
import {
  attemptsInWindow,
  recordFailedAttempt,
  secondsUntilWindowEnds,
} from '../repositories/rate-limits.js';
import { SESSION_TTL_HOURS } from './sign-in.js';

const staffAppUrl = (): string =>
  process.env['STAFF_APP_URL']?.replace(/\/+$/, '') ?? 'http://localhost:3000';

/* -------------------------------------------------------------------------- */
/* Activation                                                                  */
/* -------------------------------------------------------------------------- */

export type ConsumeInviteResult = {
  readonly token: string;
  readonly expiresAt: Date;
  readonly role: UserRole;
};

/**
 * Setting the password signs them in and lands them on their dashboard (§3).
 *
 * Never back on a sign-in form to retype the password they just chose. That is
 * the ending §8 names for this flow, and it is the whole reason a session is
 * issued here rather than a redirect.
 */
export async function consumeInvite(
  ctx: UseCaseContext,
  token: string,
  password: string,
): Promise<Result<ConsumeInviteResult, LinkNotUsable | PasswordRejected>> {
  const now = ctx.clock.now();

  const problem = checkPassword(password, ctx.config.auth.minPasswordLength);
  if (problem) return err(passwordTooShort(ctx.config.auth.minPasswordLength));

  const passwordHash = await ctx.ports.hasher.hash(password);

  return ctx.db.transaction(async (tx) => {
    const invite = await findInviteByToken(tx, ctx.ports.tokens.fingerprint(token));
    if (!invite || !isLinkUsable(invite, now)) return err(linkNotUsable());

    // Conditional: two tabs on the same link must not both set a password.
    if (!(await consumeInviteRow(tx, invite.id, now))) return err(linkNotUsable());

    const account = await findAccountById(tx, invite.userId);
    if (!account) return err(linkNotUsable());

    await tx
      .update(users)
      .set({ passwordHash, status: 'active' })
      .where(eq(users.id, invite.userId));

    const sessionToken = ctx.ports.tokens.issue();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_HOURS * 3_600_000);

    await createSession(tx, {
      id: ctx.ids.next<'SessionId'>(),
      userId: invite.userId,
      tokenHash: ctx.ports.tokens.fingerprint(sessionToken),
      audience: audienceFor(account.role),
      expiresAt,
      ip: ctx.request?.ip ?? null,
      userAgent: ctx.request?.userAgent ?? null,
    });

    await touchLastLogin(tx, invite.userId, now);

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'account.activated',
      subjectType: 'user',
      subjectId: invite.userId,
      metadata: { inviteId: invite.id },
    });

    return ok({ token: sessionToken, expiresAt, role: account.role });
  });
}

/* -------------------------------------------------------------------------- */
/* Password reset                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Always succeeds, whatever address is given.
 *
 * "The response to send-me-a-code is identical whether or not the address
 * exists" (§3). A reset form must not become an account-enumeration oracle.
 * The only visible failure is the throttle, which applies to addresses that do
 * not exist just as much as to ones that do.
 */
export async function requestPasswordOtp(
  ctx: UseCaseContext,
  emailInput: string,
): Promise<Result<Record<string, never>, RateLimited>> {
  const now = ctx.clock.now();
  const email = normaliseEmail(emailInput);
  const throttle = ctx.config.auth.loginThrottle;
  const ipKey = ctx.request?.ip ?? 'unknown';

  return ctx.db.transaction(async (tx) => {
    const [ipAttempts, accountAttempts] = await Promise.all([
      attemptsInWindow(tx, 'otp_ip', ipKey, now, throttle.windowMinutes),
      attemptsInWindow(tx, 'otp_account', email, now, throttle.windowMinutes),
    ]);

    if (
      ipAttempts >= throttle.maxAttemptsPerIp ||
      accountAttempts >= throttle.maxAttemptsPerAccount
    ) {
      return err(rateLimited(secondsUntilWindowEnds(now, throttle.windowMinutes)));
    }

    // Counted for every request, not only the ones that find an account.
    // Otherwise the throttle itself would answer "does this address exist".
    await recordFailedAttempt(tx, 'otp_ip', ipKey, now, throttle.windowMinutes);
    await recordFailedAttempt(tx, 'otp_account', email, now, throttle.windowMinutes);

    const account = await findAccountByEmail(tx, email);
    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);

    if (account?.status !== 'active') {
      await audit({
        action: 'password.otp_requested',
        subjectType: 'email',
        subjectId: email,
        metadata: { delivered: false },
      });
      return ok({});
    }

    const otp = ctx.ports.tokens.issueOtp();

    await supersedeLiveOtps(tx, account.id, now);
    await createOtp(tx, {
      id: ctx.ids.next<'OtpId'>(),
      userId: account.id,
      otpHash: ctx.ports.tokens.fingerprint(otp),
      expiresAt: new Date(now.getTime() + ctx.config.auth.otpTtlMinutes * 60_000),
    });

    await queueEmail(tx, {
      kind: 'password_otp',
      to: account.email,
      userId: account.id,
      vars: { otp, expiresInMinutes: String(ctx.config.auth.otpTtlMinutes) },
    });

    await audit({
      action: 'password.otp_requested',
      subjectType: 'user',
      subjectId: account.id,
      metadata: { delivered: true },
    });

    return ok({});
  });
}

export type ResetResult = {
  readonly token: string;
  readonly expiresAt: Date;
  readonly role: UserRole;
};

/**
 * Verifies the code and sets the new password.
 *
 * A successful reset revokes every existing session, signs them in on a fresh
 * one, and tells them by email that the password changed (§3). Revoking first
 * is what makes the reset useful after a compromise rather than merely
 * inconvenient.
 */
export async function verifyOtpAndReset(
  ctx: UseCaseContext,
  emailInput: string,
  otp: string,
  newPassword: string,
): Promise<Result<ResetResult, OtpNotAccepted | PasswordRejected>> {
  const now = ctx.clock.now();
  const email = normaliseEmail(emailInput);
  const maxAttempts = ctx.config.auth.otpMaxAttempts;

  const problem = checkPassword(newPassword, ctx.config.auth.minPasswordLength);
  if (problem) return err(passwordTooShort(ctx.config.auth.minPasswordLength));

  const passwordHash = await ctx.ports.hasher.hash(newPassword);

  return ctx.db.transaction(async (tx) => {
    const account = await findAccountByEmail(tx, email);
    if (account?.status !== 'active') return err(otpNotAccepted(0));

    const live = await findLiveOtpForUser(tx, account.id);
    if (!live || !isOtpUsable(live, now, maxAttempts)) return err(otpNotAccepted(0));

    if (live.otpHash !== ctx.ports.tokens.fingerprint(otp)) {
      const attempts = await recordOtpAttempt(tx, live.id);
      return err(otpNotAccepted(Math.max(0, maxAttempts - attempts)));
    }

    if (!(await consumeOtp(tx, live.id, now))) return err(otpNotAccepted(0));

    await setPasswordHash(tx, account.id, passwordHash);
    await revokeAllSessionsForUser(tx, account.id, now);

    const sessionToken = ctx.ports.tokens.issue();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_HOURS * 3_600_000);

    await createSession(tx, {
      id: ctx.ids.next<'SessionId'>(),
      userId: account.id,
      tokenHash: ctx.ports.tokens.fingerprint(sessionToken),
      audience: audienceFor(account.role),
      expiresAt,
      ip: ctx.request?.ip ?? null,
      userAgent: ctx.request?.userAgent ?? null,
    });

    await queueEmail(tx, {
      kind: 'password_changed',
      to: account.email,
      userId: account.id,
      vars: { fullName: account.fullName },
    });

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({ action: 'password.reset', subjectType: 'user', subjectId: account.id });

    return ok({ token: sessionToken, expiresAt, role: account.role });
  });
}

/* -------------------------------------------------------------------------- */
/* Address change, confirmed by the doctor                                     */
/* -------------------------------------------------------------------------- */

export async function requestEmailChange(
  ctx: UseCaseContext,
  newEmailInput: string,
): Promise<Result<Record<string, never>, NotAuthorized | EmailTaken>> {
  if (ctx.actor.kind !== 'user') return err(notAuthorized('profile:manage'));

  const now = ctx.clock.now();
  const newEmail = normaliseEmail(newEmailInput);
  const actorId = ctx.actor.userId;

  if (!isPlausibleEmail(newEmail)) return err(emailTaken());

  return ctx.db.transaction(async (tx) => {
    const account = await findAccountById(tx, actorId);
    if (!account) return err(notAuthorized('profile:manage'));
    if (account.email.toLowerCase() === newEmail) return err(emailTaken());

    const clash = await tx.select({ id: users.id }).from(users).where(eq(users.email, newEmail));
    if (clash.length > 0) return err(emailTaken());

    const token = ctx.ports.tokens.issue();
    const ttlHours = 24;

    await supersedeLiveEmailChanges(tx, actorId, now);
    await createEmailChange(tx, {
      id: ctx.ids.next<'UpdateRequestId'>(),
      userId: actorId,
      currentEmail: account.email,
      newEmail,
      tokenHash: ctx.ports.tokens.fingerprint(token),
      expiresAt: new Date(now.getTime() + ttlHours * 3_600_000),
    });

    // The link goes to the address being claimed. That is what proves they
    // hold it.
    await queueEmail(tx, {
      kind: 'email_change_confirm',
      to: newEmail,
      userId: actorId,
      vars: {
        fullName: account.fullName,
        link: `${staffAppUrl()}/confirm-email/${token}`,
        expiresInHours: String(ttlHours),
      },
    });

    // And a warning goes to the address being left, so an unauthorised change
    // is visible to the person about to lose the account.
    await queueEmail(tx, {
      kind: 'email_change_notice',
      to: account.email,
      userId: actorId,
      vars: { fullName: account.fullName, newEmail },
    });

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'account.email_change_requested',
      subjectType: 'user',
      subjectId: actorId,
      metadata: { from: account.email, to: newEmail },
    });

    return ok({});
  });
}

/**
 * Applied when the new address opens the link.
 *
 * Deliberately usable while signed out: the person may be confirming from a
 * phone that has never signed in, and requiring a session here would strand
 * anyone whose only device is the one holding the new inbox.
 */
export async function confirmEmailChange(
  ctx: UseCaseContext,
  token: string,
): Promise<Result<{ newEmail: string }, LinkNotUsable | EmailTaken>> {
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const request = await findEmailChangeByToken(tx, ctx.ports.tokens.fingerprint(token));
    if (!request || !isLinkUsable(request, now)) return err(linkNotUsable());

    // Someone else may have taken the address between the request and the
    // click; the unique index would reject the update anyway, and this turns
    // that into a message instead of a constraint violation.
    const clash = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, request.newEmail));
    if (clash.length > 0 && clash[0]?.id !== request.userId) return err(emailTaken());

    if (!(await consumeEmailChange(tx, request.id, now))) return err(linkNotUsable());

    await tx.update(users).set({ email: request.newEmail }).where(eq(users.id, request.userId));

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'account.email_changed',
      subjectType: 'user',
      subjectId: request.userId,
      metadata: { from: request.currentEmail, to: request.newEmail, by: 'self_confirmed' },
    });

    return ok({ newEmail: request.newEmail });
  });
}

/** Withdrawing a change they started. The flow's third ending (§8). */
export async function cancelPendingEmailChange(
  ctx: UseCaseContext,
): Promise<Result<Record<string, never>, NotAuthorized>> {
  if (ctx.actor.kind !== 'user') return err(notAuthorized('profile:manage'));

  const now = ctx.clock.now();
  const actorId = ctx.actor.userId;

  return ctx.db.transaction(async (tx) => {
    await cancelEmailChange(tx, actorId, now);

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'account.email_change_cancelled',
      subjectType: 'user',
      subjectId: actorId,
    });

    return ok({});
  });
}
