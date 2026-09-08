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
