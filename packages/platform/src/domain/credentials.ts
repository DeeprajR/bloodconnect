/**
 * Password and one-time-code rules (§3, §15). Pure.
 *
 * Thresholds arrive as parameters, never as constants, because the minimum
 * password length is configuration (§12) and the OTP lifetime is too.
 */

export type PasswordProblem =
  | { readonly kind: 'too_short'; readonly minimumLength: number }
  | { readonly kind: 'too_long' }
  | { readonly kind: 'whitespace_only' };

/**
 * Length, and nothing else.
 *
 * No character-class rules on purpose. They push people towards `Passw0rd!`,
 * which is short and guessable, and away from a long passphrase, which is
 * neither. §15 asks for a minimum of 12 and this enforces exactly that.
 *
 * The upper bound is a denial-of-service guard, not a password rule: Argon2id
 * hashes whatever it is given, and a megabyte of input costs a megabyte of
 * work per attempt.
 */
export function checkPassword(
  password: string,
  minimumLength: number,
): PasswordProblem | undefined {
  if (password.trim().length === 0) return { kind: 'whitespace_only' };
  if (password.length < minimumLength) return { kind: 'too_short', minimumLength };
  if (password.length > 1024) return { kind: 'too_long' };
  return undefined;
}

/** Six digits, as the spec describes them, kept as a string so 000123 survives. */
export const OTP_LENGTH = 6;

export const isOtpShaped = (value: string): boolean =>
  new RegExp(`^\\d{${OTP_LENGTH}}$`).test(value);

/**
 * An OTP is spent when it is used, when it expires, when a newer one replaces
 * it, or when it has been guessed at too many times (§3).
 *
 * Written as one predicate so no caller can check three of the four.
 */
export function isOtpUsable(
  otp: {
    readonly expiresAt: Date;
    readonly consumedAt: Date | null;
    readonly supersededAt: Date | null;
    readonly attempts: number;
  },
  now: Date,
  maxAttempts: number,
): boolean {
  if (otp.consumedAt !== null) return false;
  if (otp.supersededAt !== null) return false;
  if (otp.attempts >= maxAttempts) return false;
  return otp.expiresAt.getTime() > now.getTime();
}

/** The same shape for a single-use link — an invite, or an address confirmation. */
export function isLinkUsable(
  link: {
    readonly expiresAt: Date;
    readonly consumedAt: Date | null;
    readonly supersededAt: Date | null;
    readonly cancelledAt?: Date | null;
  },
  now: Date,
): boolean {
  if (link.consumedAt !== null) return false;
  if (link.supersededAt !== null) return false;
  if (link.cancelledAt) return false;
  return link.expiresAt.getTime() > now.getTime();
}

/**
 * Normalises an address for storage and comparison.
 *
 * Only trims and lowercases. Deliberately does **not** strip dots or `+tags`
 * from Gmail addresses: those are the provider's routing rules, not the
 * protocol's, and a system that decides two addresses are "really" the same is
 * a system that eventually merges two people's accounts.
 */
export const normaliseEmail = (email: string): string => email.trim().toLowerCase();

/**
 * A deliberately permissive check.
 *
 * The only proof an address works is that mail sent to it arrives, and every
 * flow here does exactly that. A stricter pattern rejects valid addresses —
 * which for a doctor locked out of the account is a much worse failure than
 * accepting one that bounces.
 */
export function isPlausibleEmail(email: string): boolean {
  const value = normaliseEmail(email);
  if (value.length < 3 || value.length > 320) return false;
  const at = value.indexOf('@');
  if (at < 1 || at !== value.lastIndexOf('@')) return false;
  const domain = value.slice(at + 1);
  return domain.length > 0 && !domain.startsWith('.') && !value.includes(' ');
}
