import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { CONFIG_DEFAULTS } from '@blood-connect/config';
import { auditLog, authRateLimits, sessions, users } from '@blood-connect/db';
import { newId, idGenerator } from '@blood-connect/ids';
import { createFakeClock } from '@blood-connect/testing';

import type { Database } from '../db.js';
import { argon2Hasher, nodeTokens } from '../adapters/crypto.js';
import { anonymousActor } from '../domain/authorization.js';
import type { UseCaseContext } from '../context.js';
import { signIn } from './sign-in.js';
import { resolveActor, signOut } from './sessions.js';

const testUrl = process.env['TEST_DATABASE_URL'];

const PASSWORD = 'a-correct-horse-battery-staple';

describe.skipIf(!testUrl)('signIn (§8.1, §13, §15)', () => {
  const client = postgres(testUrl ?? '', { max: 5, onnotice: () => undefined });
  const db = drizzle(client) as unknown as Database;

  const clock = createFakeClock('2026-09-08T09:00:00.000Z');

  let passwordHash: string;
  let activeUserId: string;

  const context = (overrides: Partial<UseCaseContext> = {}): UseCaseContext => ({
    db,
    clock,
    ids: idGenerator,
    ports: { hasher: argon2Hasher, tokens: nodeTokens },
    actor: anonymousActor,
    correlationId: newId(),
    config: CONFIG_DEFAULTS,
    request: { ip: '10.0.0.1', userAgent: 'vitest' },
    ...overrides,
  });

  beforeEach(async () => {
    await client`TRUNCATE hospital.audit_log, hospital.sessions, hospital.auth_rate_limits, hospital.users RESTART IDENTITY CASCADE`;

    // Hashed once for the whole file: Argon2id is deliberately slow.
    passwordHash = passwordHash || (await argon2Hasher.hash(PASSWORD));
    activeUserId = newId();

    await db.insert(users).values([
      {
        id: activeUserId,
        email: 'active@blood-connect.invalid',
        fullName: 'Active Account',
        role: 'doctor',
        status: 'active',
        passwordHash,
      },
      {
        id: newId(),
        email: 'deactivated@blood-connect.invalid',
        fullName: 'Deactivated Account',
        role: 'doctor',
        status: 'deactivated',
        passwordHash,
      },
      {
        id: newId(),
        email: 'invited@blood-connect.invalid',
        fullName: 'Never Activated',
        role: 'doctor',
        status: 'pending_activation',
        passwordHash: null,
      },
    ]);
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  /* ---------------------------------------------------------------- success */

  it('issues a session and lands the caller with their role', async () => {
    const result = await signIn(context(), {
      email: 'active@blood-connect.invalid',
      password: PASSWORD,
      audience: 'staff',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.user.role).toBe('doctor');
    expect(result.value.expiresAt.getTime()).toBeGreaterThan(clock.now().getTime());
  });

  it('stores only the fingerprint of the token, never the token (§13)', async () => {
    const result = await signIn(context(), {
      email: 'active@blood-connect.invalid',
      password: PASSWORD,
      audience: 'staff',
    });
    if (!result.ok) throw new Error('expected a session');

    const rows = await db.select().from(sessions);
    expect(rows).toHaveLength(1);

    // A database dump must not hand anyone a live session.
    expect(rows[0]?.tokenHash).toBe(nodeTokens.fingerprint(result.value.token));
    expect(rows[0]?.tokenHash).not.toBe(result.value.token);
    expect(JSON.stringify(rows[0])).not.toContain(result.value.token);
  });

  it('accepts the address case-insensitively (§5.3)', async () => {
    const result = await signIn(context(), {
      email: '  ACTIVE@Blood-Connect.INVALID ',
      password: PASSWORD,
      audience: 'staff',
    });
    expect(result.ok).toBe(true);
  });

  it('writes an audit row that carries no secret (§14)', async () => {
    const correlationId = newId();
    await signIn(context({ correlationId }), {
      email: 'active@blood-connect.invalid',
      password: PASSWORD,
      audience: 'staff',
    });

    const rows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.correlationId, correlationId));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('session.created');
    expect(rows[0]?.subjectId).toBe(activeUserId);

    // The audit log outlives the incident it documents.
    const serialised = JSON.stringify(rows[0]);
    expect(serialised).not.toContain(PASSWORD);
    expect(serialised).not.toContain(passwordHash);
  });

  it('resolves the issued token back to the same principal', async () => {
    const result = await signIn(context(), {
      email: 'active@blood-connect.invalid',
      password: PASSWORD,
      audience: 'staff',
    });
    if (!result.ok) throw new Error('expected a session');

    const actor = await resolveActor(
      db,
      nodeTokens.fingerprint(result.value.token),
      clock.now(),
    );

    expect(actor).toEqual({
      kind: 'user',
      userId: activeUserId,
      role: 'doctor',
      districtScopeId: null,
    });
  });

  it('stops resolving once the session is revoked, and again after that', async () => {
    const result = await signIn(context(), {
      email: 'active@blood-connect.invalid',
      password: PASSWORD,
      audience: 'staff',
    });
    if (!result.ok) throw new Error('expected a session');

    const fingerprint = nodeTokens.fingerprint(result.value.token);
    const first = await signOut(context(), fingerprint);
    expect(first.ok && first.value.revoked).toBe(true);

    expect(await resolveActor(db, fingerprint, clock.now())).toEqual({ kind: 'anonymous' });

    // Idempotent: a double-click or a replayed post is not an error (§7.4).
    const second = await signOut(context(), fingerprint);
    expect(second.ok && second.value.revoked).toBe(false);
  });

  it('stops resolving once the session has expired', async () => {
    const result = await signIn(context(), {
      email: 'active@blood-connect.invalid',
      password: PASSWORD,
      audience: 'staff',
    });
    if (!result.ok) throw new Error('expected a session');

    const fingerprint = nodeTokens.fingerprint(result.value.token);
    const afterExpiry = new Date(result.value.expiresAt.getTime() + 1000);

    expect(await resolveActor(db, fingerprint, afterExpiry)).toEqual({ kind: 'anonymous' });
  });

  it('stops resolving the moment the account is deactivated', async () => {
    const result = await signIn(context(), {
      email: 'active@blood-connect.invalid',
      password: PASSWORD,
      audience: 'staff',
    });
    if (!result.ok) throw new Error('expected a session');

    await db
      .update(users)
      .set({ status: 'deactivated' })
      .where(eq(users.id, activeUserId));

    // Deactivating ends the sessions too, which is what an admin expects the
    // word to mean.
    expect(
      await resolveActor(db, nodeTokens.fingerprint(result.value.token), clock.now()),
    ).toEqual({ kind: 'anonymous' });
  });

  /* --------------------------------------------------- identical refusals */

  it('answers identically for a wrong password, an unknown address, a deactivated account and one never activated (§15)', async () => {
    const attempts = await Promise.all([
      signIn(context(), { email: 'active@blood-connect.invalid', password: 'wrong', audience: 'staff' }),
      signIn(context({ request: { ip: '10.0.0.2', userAgent: 'vitest' } }), {
        email: 'nobody@blood-connect.invalid',
        password: PASSWORD,
        audience: 'staff',
      }),
      signIn(context({ request: { ip: '10.0.0.3', userAgent: 'vitest' } }), {
        email: 'deactivated@blood-connect.invalid',
        password: PASSWORD,
        audience: 'staff',
      }),
      signIn(context({ request: { ip: '10.0.0.4', userAgent: 'vitest' } }), {
        email: 'invited@blood-connect.invalid',
        password: PASSWORD,
        audience: 'staff',
      }),
    ]);

    for (const attempt of attempts) {
      expect(attempt.ok).toBe(false);
      if (attempt.ok) continue;
      // Byte-for-byte the same. A sign-in form that distinguishes these is an
      // account-enumeration oracle.
      expect(attempt.error).toEqual({
        kind: 'InvalidCredentials',
        message: 'Email or password is incorrect.',
      });
    }

    // And no session was created for any of them.
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it('records why it refused in the audit log, and never in the response', async () => {
    const correlationId = newId();
    await signIn(context({ correlationId }), {
      email: 'nobody@blood-connect.invalid',
      password: PASSWORD,
      audience: 'staff',
    });

    const [row] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.correlationId, correlationId));

    expect(row?.action).toBe('session.rejected');
    expect(row?.metadata).toEqual({ reason: 'no_account' });
  });

  /* ----------------------------------------------------------- throttling */

  it('throttles per account after the configured number of failures (§3)', async () => {
    const max = CONFIG_DEFAULTS.auth.loginThrottle.maxAttemptsPerAccount;

    for (let attempt = 0; attempt < max; attempt += 1) {
      const result = await signIn(context(), {
        email: 'active@blood-connect.invalid',
        password: 'wrong',
        audience: 'staff',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('InvalidCredentials');
    }

    // The next attempt is refused before the password is even considered, and
    // the correct password does not get through either.
    const blocked = await signIn(context(), {
      email: 'active@blood-connect.invalid',
      password: PASSWORD,
      audience: 'staff',
    });

    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.error.kind).toBe('RateLimited');
      if (blocked.error.kind === 'RateLimited') {
        expect(blocked.error.retryAfterSeconds).toBeGreaterThan(0);
      }
    }
  });

  it('survives a restart, because the counter is a row and not memory (§3)', async () => {
    await signIn(context(), { email: 'active@blood-connect.invalid', password: 'wrong', audience: 'staff' });

    const rows = await db
      .select()
      .from(authRateLimits)
      .where(eq(authRateLimits.scope, 'login_account'));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.attempts).toBe(1);
    expect(rows[0]?.key).toBe('active@blood-connect.invalid');
  });

  it('clears the account counter on success but never the IP counter', async () => {
    await signIn(context(), { email: 'active@blood-connect.invalid', password: 'wrong', audience: 'staff' });
    await signIn(context(), { email: 'active@blood-connect.invalid', password: PASSWORD, audience: 'staff' });

    const account = await db
      .select()
      .from(authRateLimits)
      .where(eq(authRateLimits.scope, 'login_account'));
    expect(account).toHaveLength(0);

    // On a shared hospital network, one person signing in correctly must not
    // reset an attacker's budget from the same address.
    const ip = await db
      .select()
      .from(authRateLimits)
      .where(and(eq(authRateLimits.scope, 'login_ip'), eq(authRateLimits.key, '10.0.0.1')));
    expect(ip[0]?.attempts).toBe(1);
  });

  it('counts a failure against both the account and the IP', async () => {
    await signIn(context(), { email: 'active@blood-connect.invalid', password: 'wrong', audience: 'staff' });

    const rows = await db.select().from(authRateLimits);
    expect(rows.map((r) => r.scope).sort()).toEqual(['login_account', 'login_ip']);
  });
});

describe('the password hasher', () => {
  it('produces Argon2id, not Argon2i or Argon2d', async () => {
    // The `algorithm` option is left at its default rather than named, because
    // the library's enum is unreachable under verbatimModuleSyntax. This checks
    // the real output instead of trusting that default.
    const hash = await argon2Hasher.hash('a password');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await argon2Hasher.hash('a password');
    expect(await argon2Hasher.verify(hash, 'a password')).toBe(true);
    expect(await argon2Hasher.verify(hash, 'a passwore')).toBe(false);
  });

  it('fails closed on a corrupt hash rather than throwing', async () => {
    // A damaged row locks one account out; it never lets anyone in.
    expect(await argon2Hasher.verify('not-a-hash', 'anything')).toBe(false);
    expect(await argon2Hasher.verify('', '')).toBe(false);
  });

  it('asks for a rehash when the stored parameters are weaker than current', async () => {
    expect(argon2Hasher.needsRehash('$argon2id$v=19$m=4096,t=1,p=1$abc$def')).toBe(true);
    expect(argon2Hasher.needsRehash('$argon2i$v=19$m=65536,t=3,p=1$abc$def')).toBe(true);
    expect(argon2Hasher.needsRehash(await argon2Hasher.hash('x'))).toBe(false);
  });
});

describe('session tokens', () => {
  it('issues 256 bits and never repeats', () => {
    const issued = new Set(Array.from({ length: 500 }, () => nodeTokens.issue()));
    expect(issued.size).toBe(500);
    // 32 bytes as base64url.
    expect(Buffer.from([...issued][0] ?? '', 'base64url')).toHaveLength(32);
  });

  it('fingerprints deterministically, and differently per token', () => {
    const a = nodeTokens.issue();
    expect(nodeTokens.fingerprint(a)).toBe(nodeTokens.fingerprint(a));
    expect(nodeTokens.fingerprint(a)).not.toBe(nodeTokens.fingerprint(nodeTokens.issue()));
  });
});
