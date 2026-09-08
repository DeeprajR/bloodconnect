/**
 * Password hashing and session tokens (§13).
 *
 * Adapters: they call the outside world (a native hashing library, the OS
 * random source) and contain no rule. The parameters below are the choice this
 * deployment makes; the port they sit behind is what the use cases know about.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';

import type { PasswordHasher, TokenGenerator } from '../context';

/**
 * Argon2id (§3, §13), at parameters that cost roughly 100ms on a modest server.
 *
 * Memory cost is the one that matters against GPU attack, so it is the one
 * raised first. Raising these later is safe: `needsRehash` upgrades a stored
 * hash on the next successful sign-in, which is the only moment the plaintext
 * exists.
 */
const ARGON2_OPTIONS = {
  // `algorithm` is deliberately not set: the library's default is already
  // Argon2id, and its `Algorithm` enum is an ambient const enum that cannot be
  // read under `verbatimModuleSyntax`. Naming it would mean hardcoding the
  // magic number 2, which is worse than relying on the default — so a test
  // asserts the produced hash actually starts with `$argon2id$` instead, which
  // verifies the real output rather than trusting a constant.
  memoryCost: 19_456, // 19 MiB — the OWASP minimum for Argon2id
  timeCost: 2,
  parallelism: 1,
} as const;

export const argon2Hasher: PasswordHasher = {
  hash: (plain: string) => argon2Hash(plain, ARGON2_OPTIONS),

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2Verify(hash, plain, ARGON2_OPTIONS);
    } catch {
      // A malformed or truncated hash is a corrupt row, not a valid password.
      // Failing closed here means a damaged record locks one account out rather
      // than letting anyone in.
      return false;
    }
  },

  needsRehash(hash: string): boolean {
    const memory = /\bm=(\d+)/.exec(hash);
    const time = /\bt=(\d+)/.exec(hash);
    if (!hash.startsWith('$argon2id$')) return true;
    if (!memory?.[1] || !time?.[1]) return true;
    return (
      Number(memory[1]) < ARGON2_OPTIONS.memoryCost ||
      Number(time[1]) < ARGON2_OPTIONS.timeCost
    );
  },
};

/**
 * Session tokens: 256 bits from the OS random source, base64url so the value is
 * cookie-safe without escaping.
 *
 * Only the SHA-256 fingerprint is stored (§13). SHA-256 rather than Argon2id is
 * correct here and not a shortcut: the token is already 256 bits of uniform
 * randomness, so there is no low-entropy secret to slow an attacker down over —
 * and this runs on every single request, where 100ms would be intolerable.
 */
export const nodeTokens: TokenGenerator = {
  issue: () => randomBytes(32).toString('base64url'),
  fingerprint: (token: string) => createHash('sha256').update(token).digest('hex'),
};

/**
 * Constant-time comparison for the CSRF token. Not strictly required — the
 * same-origin check is the control — but a comparison that leaks position is
 * free to avoid.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
