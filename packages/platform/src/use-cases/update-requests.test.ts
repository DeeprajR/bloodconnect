import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { CONFIG_DEFAULTS } from '@blood-connect/config';
import { accountUpdateRequests, auditLog, users } from '@blood-connect/db';
import { idGenerator, newId } from '@blood-connect/ids';
import { createFakeClock } from '@blood-connect/testing';

import type { Database } from '../db.js';
import { argon2Hasher, nodeTokens } from '../adapters/crypto.js';
import { anonymousActor, type Actor } from '../domain/authorization.js';
import type { UseCaseContext } from '../context.js';
import {
  approveUpdateRequest,
  listMyUpdateRequests,
  listPendingUpdateRequests,
  rejectUpdateRequest,
  requestAccountUpdate,
  withdrawAccountUpdate,
} from './update-requests.js';

const testUrl = process.env['TEST_DATABASE_URL'];

const START = '2026-09-08T09:00:00.000Z';

describe.skipIf(!testUrl)('the account update-request queue (§3, ADR 0011 §4)', () => {
  const client = postgres(testUrl ?? '', { max: 5, onnotice: () => undefined });
  const db = drizzle(client) as unknown as Database;

  const clock = createFakeClock(START);

  let doctorId: string;
  let adminId: string;
  let otherDoctorId: string;

  const asUser = (userId: string, role: 'doctor' | 'admin'): Actor => ({
    kind: 'user',
    userId,
    role,
    districtScopeId: null,
  });

  const context = (actor: Actor = anonymousActor): UseCaseContext => ({
    db,
    clock,
    ids: idGenerator,
    ports: { hasher: argon2Hasher, tokens: nodeTokens },
    actor,
    correlationId: newId(),
    config: CONFIG_DEFAULTS,
    request: { ip: '10.0.0.1', userAgent: 'vitest' },
  });

  beforeEach(async () => {
    // The clock is shared across the file; a test that moves it must not leave
    // it moved for the next one.
    clock.set(new Date(START));

    await client`TRUNCATE hospital.account_update_requests, hospital.audit_log, hospital.users RESTART IDENTITY CASCADE`;

    doctorId = newId();
    adminId = newId();
    otherDoctorId = newId();

    await db.insert(users).values([
      {
        id: doctorId,
        email: 'asking@blood-connect.invalid',
        fullName: 'Anitha Menon',
        role: 'doctor',
        status: 'active',
        provisionalReg: 'TCMC-11111',
        passwordHash: 'x',
      },
      {
        id: adminId,
        email: 'admin@blood-connect.invalid',
        fullName: 'The Administrator',
        role: 'admin',
        status: 'active',
        passwordHash: 'x',
      },
      {
        id: otherDoctorId,
        email: 'other@blood-connect.invalid',
        fullName: 'Someone Else',
        role: 'doctor',
        status: 'active',
        provisionalReg: 'TCMC-22222',
        passwordHash: 'x',
      },
    ]);
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  const raise = (
    field: 'full_name' | 'provisional_reg' = 'full_name',
    proposedValue = 'Anitha Menon Nair',
    reason = 'Married; the registration council has the new name.',
  ) =>
    requestAccountUpdate(context(asUser(doctorId, 'doctor')), {
      field,
      proposedValue,
      reason,
    });

  /* --------------------------------------------------------------- raising */

  it('records the value as it stood, so the admin reviews what was proposed', async () => {
    const raised = await raise();
    expect(raised.ok).toBe(true);

    // Something else edits the name in between — a rename by an admin, say.
    await db
      .update(users)
      .set({ fullName: 'A. Menon' })
      .where(eq(users.id, doctorId));

    const [pending] = await listPendingUpdateRequests(context(asUser(adminId, 'admin')));
    expect(pending?.currentValue).toBe('Anitha Menon');
    expect(pending?.proposedValue).toBe('Anitha Menon Nair');
  });

  it('refuses a second pending request for the same field', async () => {
    await raise();
    const again = await raise('full_name', 'Anitha M. Nair');

    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.kind).toBe('UpdateRequestRejected');
    if (!again.ok && again.error.kind === 'UpdateRequestRejected') {
      expect(again.error.reason).toBe('already_pending');
    }
  });

  it('allows a second field while the first is still pending', async () => {
    await raise();
    const other = await raise('provisional_reg', 'TCMC-33333', 'Permanent number issued.');
    expect(other.ok).toBe(true);
  });

  it('refuses a value that is already what the field says', async () => {
    const same = await raise('full_name', 'Anitha Menon');
    expect(same.ok).toBe(false);
    if (!same.ok && same.error.kind === 'UpdateRequestRejected') {
      expect(same.error.reason).toBe('unchanged');
    }
  });

  it('refuses a request with no reason', async () => {
    const bare = await raise('full_name', 'Anitha Nair', '   ');
    expect(bare.ok).toBe(false);
    if (!bare.ok && bare.error.kind === 'UpdateRequestRejected') {
      expect(bare.error.reason).toBe('no_reason');
    }
  });

  it('refuses a registration number another account already holds, at request time', async () => {
    const clash = await raise('provisional_reg', 'TCMC-22222', 'Correcting a typo.');
    expect(clash.ok).toBe(false);
    if (!clash.ok && clash.error.kind === 'UpdateRequestRejected') {
      expect(clash.error.reason).toBe('reg_taken');
    }
  });

  it('keeps the proposed value out of the audit log (§11.9)', async () => {
    await raise();
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'account.update_requested'));

    expect(entry).toBeDefined();
    expect(JSON.stringify(entry?.metadata)).not.toContain('Anitha');
    expect(entry?.metadata).toMatchObject({ field: 'full_name' });
  });

  /* ------------------------------------------------------------ withdrawal */

  it('lets the person withdraw, and then ask again', async () => {
    const first = await raise();
    if (!first.ok) throw new Error('setup failed');

    const withdrawn = await withdrawAccountUpdate(
      context(asUser(doctorId, 'doctor')),
      first.value.id,
    );
    expect(withdrawn.ok).toBe(true);

    // Withdrawn is not pending, so the partial index lets a second one through.
    const again = await raise('full_name', 'Anitha M. Nair');
    expect(again.ok).toBe(true);

    const mine = await listMyUpdateRequests(context(asUser(doctorId, 'doctor')));
    expect(mine.map((r) => r.status).sort()).toEqual(['pending', 'withdrawn']);
  });

  it('will not let one person withdraw another persons request', async () => {
    const first = await raise();
    if (!first.ok) throw new Error('setup failed');

    const stolen = await withdrawAccountUpdate(
      context(asUser(otherDoctorId, 'doctor')),
      first.value.id,
    );
    expect(stolen.ok).toBe(false);

    const [row] = await db
      .select()
      .from(accountUpdateRequests)
      .where(eq(accountUpdateRequests.id, first.value.id));
    expect(row?.status).toBe('pending');
  });

  /* -------------------------------------------------------------- deciding */

  it('applies the change itself on approval', async () => {
    const first = await raise();
    if (!first.ok) throw new Error('setup failed');

    const approved = await approveUpdateRequest(
      context(asUser(adminId, 'admin')),
      first.value.id,
    );
    expect(approved.ok).toBe(true);

    const [account] = await db.select().from(users).where(eq(users.id, doctorId));
    expect(account?.fullName).toBe('Anitha Menon Nair');

    const [row] = await db
      .select()
      .from(accountUpdateRequests)
      .where(eq(accountUpdateRequests.id, first.value.id));
    expect(row?.status).toBe('approved');
    expect(row?.decidedBy).toBe(adminId);
    expect(row?.decidedAt).not.toBeNull();
  });

  it('applies a registration number the same way', async () => {
    const first = await requestAccountUpdate(context(asUser(doctorId, 'doctor')), {
      field: 'provisional_reg',
      proposedValue: 'TCMC-44444',
      reason: 'Permanent registration granted.',
    });
    if (!first.ok) throw new Error('setup failed');

    const approved = await approveUpdateRequest(
      context(asUser(adminId, 'admin')),
      first.value.id,
    );
    expect(approved.ok).toBe(true);

    const [account] = await db.select().from(users).where(eq(users.id, doctorId));
    expect(account?.provisionalReg).toBe('TCMC-44444');
  });

  it('refuses a self-approval (§3)', async () => {
    const own = await requestAccountUpdate(context(asUser(adminId, 'admin')), {
      field: 'full_name',
      proposedValue: 'The Other Administrator',
      reason: 'Spelling.',
    });
    if (!own.ok) throw new Error('setup failed');

    const self = await approveUpdateRequest(
      context(asUser(adminId, 'admin')),
      own.value.id,
    );
    expect(self.ok).toBe(false);
    if (!self.ok && self.error.kind === 'UpdateRequestRejected') {
      expect(self.error.reason).toBe('own_request');
    }

    const [account] = await db.select().from(users).where(eq(users.id, adminId));
    expect(account?.fullName).toBe('The Administrator');
  });

  it('refuses a self-rejection too, so nobody can quietly bury their own', async () => {
    const own = await requestAccountUpdate(context(asUser(adminId, 'admin')), {
      field: 'full_name',
      proposedValue: 'The Other Administrator',
      reason: 'Spelling.',
    });
    if (!own.ok) throw new Error('setup failed');

    const self = await rejectUpdateRequest(
      context(asUser(adminId, 'admin')),
      own.value.id,
      'No.',
    );
    expect(self.ok).toBe(false);
  });

  it('refuses a registration number taken between the request and the approval', async () => {
    const first = await requestAccountUpdate(context(asUser(doctorId, 'doctor')), {
      field: 'provisional_reg',
      proposedValue: 'TCMC-55555',
      reason: 'Permanent registration granted.',
    });
    if (!first.ok) throw new Error('setup failed');

    // Somebody else is given it while the request waits in the queue.
    await db
      .update(users)
      .set({ provisionalReg: 'TCMC-55555' })
      .where(eq(users.id, otherDoctorId));

    const approved = await approveUpdateRequest(
      context(asUser(adminId, 'admin')),
      first.value.id,
    );
    expect(approved.ok).toBe(false);
    if (!approved.ok && approved.error.kind === 'UpdateRequestRejected') {
      expect(approved.error.reason).toBe('reg_taken');
    }

    const [account] = await db.select().from(users).where(eq(users.id, doctorId));
    expect(account?.provisionalReg).toBe('TCMC-11111');
  });

  it('rejects with a reason the person can act on, and changes nothing', async () => {
    const first = await raise();
    if (!first.ok) throw new Error('setup failed');

    const rejected = await rejectUpdateRequest(
      context(asUser(adminId, 'admin')),
      first.value.id,
      'Send the council letter to the office first.',
    );
    expect(rejected.ok).toBe(true);

    const [account] = await db.select().from(users).where(eq(users.id, doctorId));
    expect(account?.fullName).toBe('Anitha Menon');

    const [mine] = await listMyUpdateRequests(context(asUser(doctorId, 'doctor')));
    expect(mine?.status).toBe('rejected');
    expect(mine?.adminNote).toBe('Send the council letter to the office first.');
  });

  it('refuses a rejection with no note', async () => {
    const first = await raise();
    if (!first.ok) throw new Error('setup failed');

    const bare = await rejectUpdateRequest(
      context(asUser(adminId, 'admin')),
      first.value.id,
      '  ',
    );
    expect(bare.ok).toBe(false);
    if (!bare.ok && bare.error.kind === 'UpdateRequestRejected') {
      expect(bare.error.reason).toBe('no_reason');
    }
  });

  it('will not decide the same request twice', async () => {
    const first = await raise();
    if (!first.ok) throw new Error('setup failed');

    await approveUpdateRequest(context(asUser(adminId, 'admin')), first.value.id);
    const again = await rejectUpdateRequest(
      context(asUser(adminId, 'admin')),
      first.value.id,
      'Changed my mind.',
    );

    expect(again.ok).toBe(false);
    if (!again.ok && again.error.kind === 'UpdateRequestRejected') {
      expect(again.error.reason).toBe('already_decided');
    }
  });

  it('will not decide one the person has already withdrawn', async () => {
    const first = await raise();
    if (!first.ok) throw new Error('setup failed');

    await withdrawAccountUpdate(context(asUser(doctorId, 'doctor')), first.value.id);
    const late = await approveUpdateRequest(
      context(asUser(adminId, 'admin')),
      first.value.id,
    );

    expect(late.ok).toBe(false);

    const [account] = await db.select().from(users).where(eq(users.id, doctorId));
    expect(account?.fullName).toBe('Anitha Menon');
  });

  /* ----------------------------------------------------------- the ageing ⚠︎ */

  it('ages an untouched request and lists the oldest first', async () => {
    await raise();

    clock.advanceDays(3);
    await requestAccountUpdate(context(asUser(otherDoctorId, 'doctor')), {
      field: 'full_name',
      proposedValue: 'Someone Else Entirely',
      reason: 'Spelling.',
    });

    clock.advanceDays(2);
    const queue = await listPendingUpdateRequests(context(asUser(adminId, 'admin')));

    expect(queue).toHaveLength(2);
    expect(queue[0]?.userId).toBe(doctorId);
    expect(queue[0]?.ageDays).toBe(5);
    expect(queue[1]?.ageDays).toBe(2);
    expect(queue[0]?.requesterName).toBe('Anitha Menon');
  });

  it('drops a decided request off the queue', async () => {
    const first = await raise();
    if (!first.ok) throw new Error('setup failed');

    await approveUpdateRequest(context(asUser(adminId, 'admin')), first.value.id);
    expect(await listPendingUpdateRequests(context(asUser(adminId, 'admin')))).toHaveLength(0);
  });

  /* ------------------------------------------------------------ signed out */

  it('refuses an anonymous caller', async () => {
    const anon = await requestAccountUpdate(context(), {
      field: 'full_name',
      proposedValue: 'Nobody',
      reason: 'Because.',
    });
    expect(anon.ok).toBe(false);
    if (!anon.ok) expect(anon.error.kind).toBe('NotAuthorized');
  });
});
