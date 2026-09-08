import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { CONFIG_DEFAULTS } from '@blood-connect/config';
import {
  auditLog,
  donorDemand,
  donorDemandConfirmations,
  users,
  walkInDonations,
} from '@blood-connect/db';
import { idGenerator, newId } from '@blood-connect/ids';
import { createFakeClock } from '@blood-connect/testing';
import {
  argon2Hasher,
  nodeTokens,
  type Actor,
  type Database,
  type UseCaseContext,
} from '@blood-connect/platform';

import {
  countUnmarked,
  listRoster,
  listWalkIns,
  markRosterOutcome,
  recordWalkIn,
} from './roster.js';

const testUrl = process.env['TEST_DATABASE_URL'];
const CENTRE_ID = '01930000-0000-7000-8000-000000000001';

describe.skipIf(!testUrl)('the counter roster (§4, §8.3)', () => {
  const client = postgres(testUrl ?? '', { max: 8, onnotice: () => undefined });
  const db = drizzle(client) as unknown as Database;
  const clock = createFakeClock('2026-09-09T09:00:00.000Z');

  let counter: Actor;
  let counterId: string;
  let demandId: string;
  let seq = 0;

  const context = (actor: Actor = counter): UseCaseContext => ({
    db,
    clock,
    ids: idGenerator,
    ports: { hasher: argon2Hasher, tokens: nodeTokens },
    actor,
    correlationId: newId(),
    config: CONFIG_DEFAULTS,
  });

  beforeEach(async () => {
    await client`TRUNCATE hospital.audit_log, hospital.walk_in_donations,
                          hospital.donor_demand_confirmations,
                          hospital.donor_demand, hospital.users RESTART IDENTITY CASCADE`;
    await client`INSERT INTO hospital.centres (id, name) VALUES (${CENTRE_ID}, 'Test centre')
                 ON CONFLICT (id) DO NOTHING`;

    counterId = newId();
    counter = { kind: 'user', userId: counterId, role: 'blood_centre', districtScopeId: null };
    await db.insert(users).values({
      id: counterId,
      email: `counter-${counterId}@blood-connect.invalid`,
      fullName: 'Counter Staff',
      role: 'blood_centre',
      status: 'active',
      passwordHash: 'x'.repeat(20),
    });

    demandId = newId();
    await db.insert(donorDemand).values({
      id: demandId,
      centreId: CENTRE_ID,
      trigger: 'stock_floor',
      bloodGroup: 'O+',
      product: 'whole_blood',
      units: 3,
      dateRequired: clock.today(),
      hospitalName: 'Test centre',
      hospitalAddress: 'Somewhere',
      districtId: 'TEST_DISTRICT',
      status: 'open',
    });
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  /** A donor who said yes in the bot, as the bot would have written them. */
  async function confirmed(bloodGroup = 'O+'): Promise<string> {
    seq += 1;
    const id = newId();
    await db.insert(donorDemandConfirmations).values({
      id,
      demandId,
      donorId: newId(),
      channel: 'telegram',
      donorName: `Synthetic Donor ${String(seq)}`,
      donorPhone: `+9199000000${String(seq).padStart(2, '0')}`,
      bloodGroup,
      confirmedAt: clock.now(),
      status: 'confirmed',
    });
    return id;
  }

  it('shows the counter a name and a number, which is what a desk needs', async () => {
    await confirmed();
    const roster = await listRoster(context(), demandId);

    expect(roster).toHaveLength(1);
    expect(roster[0]?.donorName).toBe('Synthetic Donor 1');
    expect(roster[0]?.donorPhone).toMatch(/^\+91/);
    // The bot has not thanked them yet; the screen says so rather than implying
    // the donor already knows they are expected.
    expect(roster[0]?.acknowledged).toBe(false);
  });

  it('records a donation with the unit and the group it typed as', async () => {
    const id = await confirmed('O+');

    const result = await markRosterOutcome(context(), {
      confirmationId: id,
      outcome: 'completed',
      bagIdentifier: 'U-ROSTER-1',
      // The counter typed B+ off the unit. The donor believed O+.
      donatedBloodGroup: 'B+',
    });

    expect(result.ok).toBe(true);
    const [row] = await db
      .select()
      .from(donorDemandConfirmations)
      .where(eq(donorDemandConfirmations.id, id));

    expect(row?.status).toBe('completed');
    expect(row?.donatedAt).toBe(clock.today());
    expect(row?.bagIdentifier).toBe('U-ROSTER-1');
    /**
     * Both groups survive, side by side.
     *
     * The declared one is not overwritten here: this row is the evidence that
     * the register disagreed with the donor, and the bot needs both halves to
     * decide what to correct (contract 1.1.0).
     */
    expect(row?.bloodGroup).toBe('O+');
    expect(row?.donatedBloodGroup).toBe('B+');
    expect(row?.markedBy).toBe(counterId);
    // Left for the bot: it, not the counter, decides the donor has been told.
    expect(row?.acknowledgedAt).toBeNull();
  });

  it('refuses a donation with no unit number', async () => {
    const id = await confirmed();
    const result = await markRosterOutcome(context(), {
      confirmationId: id,
      outcome: 'completed',
      bagIdentifier: '   ',
    });

    // Without it nothing links this donor to the unit that came out of them,
    // and §4 requires that trace.
    expect(result.ok).toBe(false);
  });

  it('refuses a group that is not a group', async () => {
    const id = await confirmed();
    const result = await markRosterOutcome(context(), {
      confirmationId: id,
      outcome: 'completed',
      bagIdentifier: 'U-ROSTER-2',
      donatedBloodGroup: 'Q-',
    });

    expect(result.ok).toBe(false);
  });

  it('marks a donor once, however many times the button is pressed (§7.4)', async () => {
    const id = await confirmed();

    const first = await markRosterOutcome(context(), {
      confirmationId: id,
      outcome: 'completed',
      bagIdentifier: 'U-ROSTER-3',
      donatedBloodGroup: 'O+',
    });
    // The second is not a second donation. Rolling an interval forward twice
    // would push a real donor months past when they may safely give again.
    const second = await markRosterOutcome(context(), {
      confirmationId: id,
      outcome: 'no_show',
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);

    const [row] = await db
      .select()
      .from(donorDemandConfirmations)
      .where(eq(donorDemandConfirmations.id, id));
    expect(row?.status).toBe('completed');
  });

  it('carries no name into the audit log (§11.9)', async () => {
    const id = await confirmed();
    await markRosterOutcome(context(), {
      confirmationId: id,
      outcome: 'completed',
      bagIdentifier: 'U-ROSTER-4',
      donatedBloodGroup: 'O+',
    });

    const rows = await db.select().from(auditLog).where(eq(auditLog.subjectId, id));
    const written = JSON.stringify(rows);
    expect(rows.length).toBeGreaterThan(0);
    expect(written).not.toContain('Synthetic Donor');
    expect(written).not.toContain('+9199');
  });

  it('leaves a no-show with no unit and no date', async () => {
    const id = await confirmed();
    const result = await markRosterOutcome(context(), {
      confirmationId: id,
      outcome: 'no_show',
    });

    expect(result.ok).toBe(true);
    const [row] = await db
      .select()
      .from(donorDemandConfirmations)
      .where(eq(donorDemandConfirmations.id, id));
    expect(row?.donatedAt).toBeNull();
    expect(row?.bagIdentifier).toBeNull();
  });

  it('counts only the donors still to be seen', async () => {
    const a = await confirmed();
    await confirmed();

    expect(await countUnmarked(context(), demandId)).toBe(2);
    await markRosterOutcome(context(), {
      confirmationId: a,
      outcome: 'completed',
      bagIdentifier: 'U-ROSTER-5',
      donatedBloodGroup: 'O+',
    });
    expect(await countUnmarked(context(), demandId)).toBe(1);
  });

  /* ------------------------------------------------------------ walk-ins */

  describe('walk-ins (§4)', () => {
    it('records somebody who gave without ever confirming', async () => {
      const result = await recordWalkIn(context(), {
        demandId,
        donorName: 'Synthetic Walk In',
        donorPhone: '+919900000099',
        bloodGroup: 'A+',
        bagIdentifier: 'U-WALKIN-1',
      });

      expect(result.ok).toBe(true);
      const walkIns = await listWalkIns(context(), demandId);

      expect(walkIns).toHaveLength(1);
      expect(walkIns[0]?.bagIdentifier).toBe('U-WALKIN-1');
      expect(walkIns[0]?.bloodGroup).toBe('A+');
      expect(walkIns[0]?.donatedOn).toBe(clock.today());
    });

    /**
     * The reason this table exists at all.
     *
     * A walk-in used to be inserted as a confirmation row, which passed every
     * test — the suite connects as `migrator` — and was refused by the database
     * the moment it ran as `app_web`. The centre holds no INSERT there (§5.1).
     */
    it('does not touch the roster the bot owns', async () => {
      await recordWalkIn(context(), {
        demandId,
        donorName: 'Synthetic Walk In',
        donorPhone: '+919900000098',
        bloodGroup: 'O+',
        bagIdentifier: 'U-WALKIN-2',
      });

      const roster = await listRoster(context(), demandId);
      expect(roster).toHaveLength(0);

      const rows = await db
        .select()
        .from(walkInDonations)
        .where(eq(walkInDonations.demandId, demandId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.recordedBy).toBe(counterId);
    });

    it('refuses a walk-in against a demand that does not exist', async () => {
      const result = await recordWalkIn(context(), {
        demandId: newId(),
        donorName: 'Synthetic Walk In',
        donorPhone: '+919900000097',
        bloodGroup: 'O+',
        bagIdentifier: 'U-WALKIN-3',
      });

      expect(result.ok).toBe(false);
    });

    it('refuses a walk-in with no unit number, name or group', async () => {
      const base = {
        demandId,
        donorName: 'Synthetic Walk In',
        donorPhone: '+919900000096',
        bloodGroup: 'O+',
        bagIdentifier: 'U-WALKIN-4',
      };

      expect((await recordWalkIn(context(), { ...base, bagIdentifier: ' ' })).ok).toBe(false);
      expect((await recordWalkIn(context(), { ...base, donorName: ' ' })).ok).toBe(false);
      expect((await recordWalkIn(context(), { ...base, donorPhone: ' ' })).ok).toBe(false);
      expect((await recordWalkIn(context(), { ...base, bloodGroup: 'Z+' })).ok).toBe(false);
    });

    it('carries no name into the audit log either (§11.9)', async () => {
      const result = await recordWalkIn(context(), {
        demandId,
        donorName: 'Synthetic Walk In',
        donorPhone: '+919900000095',
        bloodGroup: 'O+',
        bagIdentifier: 'U-WALKIN-6',
      });

      const id = result.ok ? result.value.walkInId : '';
      const rows = await db.select().from(auditLog).where(eq(auditLog.subjectId, id));
      const written = JSON.stringify(rows);
      expect(rows.length).toBeGreaterThan(0);
      expect(written).not.toContain('Synthetic Walk In');
      expect(written).not.toContain('+9199');
    });
  });

  /* ---------------------------------------------------------------- authz */

  it('refuses a doctor at the counter (§9)', async () => {
    const id = await confirmed();
    const doctor: Actor = {
      kind: 'user',
      userId: newId(),
      role: 'doctor',
      districtScopeId: null,
    };

    const marked = await markRosterOutcome(context(doctor), {
      confirmationId: id,
      outcome: 'no_show',
    });
    const walkIn = await recordWalkIn(context(doctor), {
      demandId,
      donorName: 'Synthetic Walk In',
      donorPhone: '+919900000095',
      bloodGroup: 'O+',
      bagIdentifier: 'U-WALKIN-5',
    });

    expect(marked.ok).toBe(false);
    expect(walkIn.ok).toBe(false);
  });
});
