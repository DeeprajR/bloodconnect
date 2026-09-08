/**
 * The platform error taxonomy (§3, §11.4).
 *
 * Expected failures are values. An adapter maps one of these to an HTTP status
 * or a form message; none of them is an exception, because none of them is a
 * bug.
 */

export type InvalidCredentials = {
  readonly kind: 'InvalidCredentials';
  /**
   * Deliberately one message for "no such account", "wrong password" and
   * "account deactivated" (§15). A sign-in form that distinguishes them is an
   * account-enumeration oracle, and the three cases are indistinguishable to
   * the person who genuinely mistyped.
   */
  readonly message: 'Email or password is incorrect.';
};

export type RateLimited = {
  readonly kind: 'RateLimited';
  readonly retryAfterSeconds: number;
  readonly message: string;
};

export type NotAuthorized = {
  readonly kind: 'NotAuthorized';
  readonly permission: string;
  readonly message: string;
};

export type SessionInvalid = {
  readonly kind: 'SessionInvalid';
  readonly message: string;
};

export type PasswordRejected = {
  readonly kind: 'PasswordRejected';
  readonly reason: 'too_short';
  readonly minimumLength: number;
  readonly message: string;
};

export type PlatformError =
  | InvalidCredentials
  | RateLimited
  | NotAuthorized
  | SessionInvalid
  | PasswordRejected;

export const invalidCredentials = (): InvalidCredentials => ({
  kind: 'InvalidCredentials',
  message: 'Email or password is incorrect.',
});

export const rateLimited = (retryAfterSeconds: number): RateLimited => ({
  kind: 'RateLimited',
  retryAfterSeconds,
  message: `Too many attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`,
});

export const notAuthorized = (permission: string): NotAuthorized => ({
  kind: 'NotAuthorized',
  permission,
  message: 'You do not have access to this.',
});

export const sessionInvalid = (): SessionInvalid => ({
  kind: 'SessionInvalid',
  message: 'Your session has ended. Sign in again.',
});

export const passwordTooShort = (minimumLength: number): PasswordRejected => ({
  kind: 'PasswordRejected',
  reason: 'too_short',
  minimumLength,
  message: `Use at least ${minimumLength} characters.`,
});

/* -------------------------------------------------------------------------- */
/* Account lifecycle                                                           */
/* -------------------------------------------------------------------------- */

export type EmailTaken = {
  readonly kind: 'EmailTaken';
  readonly message: string;
};

export type AccountNotFound = {
  readonly kind: 'AccountNotFound';
  readonly message: string;
};

/**
 * One error for expired, already used, and superseded by a newer link.
 *
 * The three are not distinguished on purpose: whoever is holding a dead link
 * needs the same next step, and telling an unauthenticated caller which of the
 * three it was tells them whether the account exists.
 */
export type LinkNotUsable = {
  readonly kind: 'LinkNotUsable';
  readonly message: string;
};

export type OtpNotAccepted = {
  readonly kind: 'OtpNotAccepted';
  readonly attemptsRemaining: number;
  readonly message: string;
};

export type SealRejected = {
  readonly kind: 'SealRejected';
  readonly reason: 'not_png' | 'too_large' | 'malformed';
  readonly message: string;
};

export type LastAdministrator = {
  readonly kind: 'LastAdministrator';
  readonly message: string;
};

export type AccountLifecycleError =
  | EmailTaken
  | AccountNotFound
  | LinkNotUsable
  | OtpNotAccepted
  | SealRejected
  | LastAdministrator
  | NotAuthorized
  | PasswordRejected
  | RateLimited;

export const emailTaken = (): EmailTaken => ({
  kind: 'EmailTaken',
  // Said plainly: an administrator typing a colleague's address needs to know
  // it is already in use. This is not a sign-in form, and the caller is an
  // authenticated administrator, so there is no enumeration to protect against.
  message: 'That email address already belongs to an account.',
});

export const accountNotFound = (): AccountNotFound => ({
  kind: 'AccountNotFound',
  message: 'That account no longer exists.',
});

export const linkNotUsable = (): LinkNotUsable => ({
  kind: 'LinkNotUsable',
  message: 'This link has expired or has already been used. Ask for a new one.',
});

export const otpNotAccepted = (attemptsRemaining: number): OtpNotAccepted => ({
  kind: 'OtpNotAccepted',
  attemptsRemaining,
  message:
    attemptsRemaining > 0
      ? 'That code is not right. Check it and try again.'
      : 'That code is no longer usable. Start the reset again.',
});

export const sealRejected = (reason: SealRejected['reason']): SealRejected => ({
  kind: 'SealRejected',
  reason,
  message: {
    not_png: 'The seal must be a PNG image.',
    too_large: 'The seal must be 1 MB or smaller.',
    malformed: 'That file could not be read as a PNG image.',
  }[reason],
});

export const lastAdministrator = (): LastAdministrator => ({
  kind: 'LastAdministrator',
  message: 'This is the last active administrator, so it cannot be removed.',
});
