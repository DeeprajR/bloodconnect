/**
 * The use-case context (§3).
 *
 * Every use case takes `{ db, clock, ids, ports, actor, correlationId }`. Time,
 * randomness and identity are injected rather than reached for, which is what
 * makes interval, expiry and session-expiry logic testable without freezing a
 * global, and what stops a use case quietly depending on ambient state.
 *
 * The use case is also the transaction boundary: no repository opens its own
 * transaction and no route handler opens one, so "what happens atomically" is
 * readable in a single file (§11.1).
 */

import type { AppConfig } from '@blood-connect/config';
import type { Clock } from '@blood-connect/domain';
import type { IdGenerator } from '@blood-connect/ids';

import type { Database, Transaction } from './db.js';
import type { Actor } from './domain/authorization.js';

/** Hashing lives behind a port so the algorithm is an adapter choice (§10). */
export type PasswordHasher = {
  readonly hash: (plain: string) => Promise<string>;
  readonly verify: (hash: string, plain: string) => Promise<boolean>;
  /**
   * True when a stored hash was produced with weaker parameters than the
   * current ones. A successful sign-in is the only moment the plaintext is
   * available to upgrade it.
   */
  readonly needsRehash: (hash: string) => boolean;
};

export type TokenGenerator = {
  /** 256 bits of randomness, returned as the value that goes in the cookie. */
  readonly issue: () => string;
  /** SHA-256 of a token. Only this is stored (§3, §13). */
  readonly fingerprint: (token: string) => string;
  /**
   * A six-digit reset code, from the same random source as a token.
   *
   * Short because a human retypes it from an email, which is exactly why it is
   * paired with a ten-minute expiry, a small attempt limit and a throttle.
   * A million possibilities is not much on its own (§3).
   */
  readonly issueOtp: () => string;
};

export type PlatformPorts = {
  readonly hasher: PasswordHasher;
  readonly tokens: TokenGenerator;
};

export type UseCaseContext = {
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly ports: PlatformPorts;
  readonly actor: Actor;
  /** Ties every write in one request or job run together (§14). */
  readonly correlationId: string;
  readonly config: AppConfig;
  /** Present on a browser request; absent for a job. */
  readonly request?: RequestMetadata;
};

export type RequestMetadata = {
  readonly ip: string | null;
  readonly userAgent: string | null;
};

/** The same context with `db` narrowed to an open transaction. */
export type TransactionContext = Omit<UseCaseContext, 'db'> & { readonly db: Transaction };
