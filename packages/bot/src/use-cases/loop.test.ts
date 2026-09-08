import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { CONFIG_DEFAULTS } from '@blood-connect/config';
import * as bot from '@blood-connect/db/bot';
import { donorDemand, donorDemandConfirmations } from '@blood-connect/db';
import {
  addDays,
  parseCalendarDay,
  subtractDays,
  type BloodGroup,
  type CalendarDay,
} from '@blood-connect/domain';
import { idGenerator, newId } from '@blood-connect/ids';
import { createFakeClock } from '@blood-connect/testing';

import { createMemoryChannel, type MemoryChannel } from '../adapters/memory-channel.js';
import { readableDay } from '../messages.js';
import { createChannelRegistry } from '../ports/channel.js';
import type { BotContext } from '../context.js';
import type { BotDatabase } from '../db.js';
import { drainOutbox, countStuckStandDowns } from '../outbox.js';
import { QUESTION_COUNT } from '../screening.js';
import { closeDemand, findCancelledDemands } from './close-demand.js';
import { importOpenDemands } from './import-demand.js';
import {
  acceptRequest,
  answerScreeningQuestion,
  declineRequest,
  promoteFromWaitlist,
} from './journey.js';
import { applyCounterOutcomes } from './outcomes.js';
import { isEligible, selectWave, sendWave } from './waves.js';

const testUrl = process.env['TEST_DATABASE_URL'];
const CENTRE_ID = '01930000-0000-7000-8000-000000000001';
const DISTRICT_ID = 'TEST_BOT_DISTRICT';

describe.skipIf(!testUrl)('the bot loop (§7.3, §7.4, §7.6, §7.7)', () => {
  const client = postgres(testUrl ?? '', { max: 12, onnotice: () => undefined });
  const db = drizzle(client, { schema: bot }) as unknown as BotDatabase;
  const clock = createFakeClock('2026-09-08T09:00:00.000Z');
  let channel: MemoryChannel;
  let donorSeq = 0;

  const context = (overrides: Partial<BotContext> = {}): BotContext => ({
    db,
    clock,
    ids: idGenerator,
    channel: createChannelRegistry(channel),
    config: CONFIG_DEFAULTS,
    correlationId: newId(),
    ...overrides,
  });

  beforeEach(async () => {
    channel = createMemoryChannel();

    await client`TRUNCATE bot.event_log, bot.message_outbox, bot.bot_jobs,
                          bot.donor_requests, bot.bot_requests, bot.conversation_state,
                          bot.donor_screening_answers, bot.donor_consents,
                          bot.donor_phones, bot.donor_channels, bot.donors
                 RESTART IDENTITY CASCADE`;
    await client`DELETE FROM hospital.donor_demand_confirmations`;
    await client`DELETE FROM hospital.donor_demand`;

    await client`INSERT INTO hospital.centres (id, name) VALUES (${CENTRE_ID}, 'Test centre')
                 ON CONFLICT (id) DO NOTHING`;
    await client`INSERT INTO reference.location_dataset_versions (version, source)
                 VALUES ('test', 'vitest') ON CONFLICT (version) DO NOTHING`;
    await client`INSERT INTO reference.location_nodes
                   (id, level, kind, parent_id, name, name_normalised, dataset_version)
                 VALUES (${DISTRICT_ID}, 'district', 'district', NULL, 'Bot District',
                         'bot district', 'test')
                 ON CONFLICT (id) DO NOTHING`;
  });

  afterAll(async () => {
    // Shared reference data: another suite asserts the seed loaded exactly one
    // district, so this one takes its own row with it. The donors referencing
    // it go first — the foreign key is the point, not an obstacle.
    await client`TRUNCATE bot.event_log, bot.message_outbox, bot.donor_requests,
                          bot.bot_requests, bot.conversation_state,
                          bot.donor_screening_answers, bot.donor_consents,
                          bot.donor_phones, bot.donor_channels, bot.donors
                 RESTART IDENTITY CASCADE`;
    await client`DELETE FROM hospital.donor_demand_confirmations`;
    await client`DELETE FROM hospital.donor_demand`;
    await client`DELETE FROM reference.location_nodes WHERE id LIKE 'TEST%'`;
    await client.end({ timeout: 5 });
  });

  /* ------------------------------------------------------------- fixtures */

  /** An open demand, as the centre would have raised it. */
  async function openDemand(units = 1, bloodGroup: BloodGroup = 'O+'): Promise<string> {
    const id = newId();
    await client`INSERT INTO hospital.donor_demand
                   (id, centre_id, trigger, blood_group, product, units, date_required,
                    hospital_name, hospital_address, district_id, status)
                 VALUES (${id}, ${CENTRE_ID}, 'stock_floor', ${bloodGroup}, 'whole_blood',
                         ${units}, ${addDays(clock.today(), 2)}, 'Test centre',
                         'Test address', ${DISTRICT_ID}, 'open')`;
    return id;
  }

  /** A registered, verified, eligible donor with a channel. */
  async function makeDonor(
    overrides: Partial<{
      bloodGroup: BloodGroup;
      dob: string;
      weightKg: number;
      nextEligibleOn: string | null;
      verified: boolean;
      consent: boolean;
      optedOut: boolean;
      flagged: boolean;
      snoozeUntil: string | null;
      districtId: string | null;
      lastDonatedOn: string | null;
    }> = {},
  ): Promise<{ donorId: string; channelUserId: string }> {
    donorSeq += 1;
    const donorId = newId();
    // UUIDv7 shares a prefix within a millisecond, so the whole id is used —
    // a short slice collides on the unique (channel, channel_user_id) index.
    const channelUserId = `tg-${donorId}`;

    await db.insert(bot.donors).values({
      id: donorId,
      name: `Synthetic Donor ${donorId.slice(0, 4)}`,
      dob: overrides.dob ?? '1995-01-01',
      sex: 'male',
      bloodGroup: overrides.bloodGroup ?? 'O+',
      bloodGroupVerifiedAt: overrides.verified === false ? null : clock.now(),
      weightBand: '60_70',
      weightKg: overrides.weightKg ?? 65,
      districtId: overrides.districtId === undefined ? DISTRICT_ID : overrides.districtId,
      lastDonatedOn: overrides.lastDonatedOn ?? null,
      nextEligibleOn: overrides.nextEligibleOn ?? null,
      durableFlagStatus: overrides.flagged ? 'flagged' : 'clear',
      snoozeUntil: overrides.snoozeUntil ?? null,
      optedOutAt: overrides.optedOut ? clock.now() : null,
      consentCurrentAt: overrides.consent === false ? null : clock.now(),
    });

    await db.insert(bot.donorChannels).values({
      donorId,
      channel: 'memory',
      channelUserId,
    });

    await db.insert(bot.donorPhones).values({
      donorId,
      // A counter, because the verified-phone index is unique and a hash of
      // the id collides often enough to break a suite intermittently.
      e164: `+9199${String(donorSeq).padStart(8, '0')}`,
      verified: true,
      verifiedAt: clock.now(),
    });

    return { donorId, channelUserId };
  }

  /** Walks a journey through the whole questionnaire, answering safely. */
  async function passScreening(journeyId: string): Promise<unknown> {
    const accepted = await acceptRequest(context(), journeyId);
    if (!accepted.ok) return accepted;

    let last: unknown;
    for (let i = 0; i < QUESTION_COUNT; i += 1) {
      // The safe answer differs per question; the domain knows which.
      const question = (await import('../screening.js')).questionAt(i);
      last = await answerScreeningQuestion(
        context(),
        journeyId,
        i,
        question?.proceedOn ?? 'yes',
      );
      if (last && typeof last === 'object' && 'ok' in last && !last.ok) return last;
    }
    return last;
  }

  async function journeyFor(botRequestId: string, donorId: string): Promise<string> {
    const [row] = await db
      .select({ id: bot.donorRequests.id })
      .from(bot.donorRequests)
      .where(
        and(
          eq(bot.donorRequests.botRequestId, botRequestId),
          eq(bot.donorRequests.donorId, donorId),
        ),
      );
    return row?.id ?? '';
  }

  /* ==================================================================== */
  /* §7.6 — the stand-down. Written first, deliberately.                   */
  /* ==================================================================== */

  describe('the stand-down (§7.6)', () => {
    it('queues a stand-down for every donor still waiting, in the closing transaction', async () => {
      await openDemand(3);
      const [imported] = await importOpenDemands(context());
      if (!imported) throw new Error('nothing imported');

      const a = await makeDonor();
      const b = await makeDonor();
      // A third who only ever gets notified, and is therefore still waiting.
      await makeDonor();
      await sendWave(context(), imported.botRequestId);

      // One accepts and confirms, one accepts and is mid-questionnaire, one has
      // only been notified. All three are waiting on this request.
      await passScreening(await journeyFor(imported.botRequestId, a.donorId));
      await acceptRequest(context(), await journeyFor(imported.botRequestId, b.donorId));

      const result = await closeDemand(context(), imported.botRequestId, 'cancelled');
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.closed).toBe(true);
      // Every one of the five live states stands down — not only the confirmed.
      expect(result.value.standDowns).toBe(3);
      expect(result.value.journeysEnded).toBe(3);

      const queued = await db
        .select()
        .from(bot.messageOutbox)
        .where(eq(bot.messageOutbox.kind, 'stand_down'));
      expect(queued).toHaveLength(3);
      expect(queued.every((row) => row.status === 'pending')).toBe(true);

      // Committed with the closure, not sent inside it: nothing has gone out yet.
      expect(channel.sent).toHaveLength(0);
    });

    it('sends them on the next drain, and says so in the row', async () => {
      await openDemand(2);
      const [imported] = await importOpenDemands(context());
      if (!imported) throw new Error('nothing imported');
      const donor = await makeDonor();
      await sendWave(context(), imported.botRequestId);
      await closeDemand(context(), imported.botRequestId, 'cancelled');

      const drain = await drainOutbox(context());
      expect(drain.sent).toBeGreaterThanOrEqual(1);

      const messages = channel.to(donor.channelUserId);
      const standDown = messages.find((m) => m.text.includes('no longer needed'));
      expect(standDown).toBeDefined();
      // It thanks them first. Somebody who agreed to give blood and is no
      // longer needed has done nothing wrong (§2.7).
      expect(standDown?.text.startsWith('Thank you')).toBe(true);
      expect(standDown?.text).toContain('Please do not travel');
    });

    it('never sends a stand-down twice, however often the closure is replayed', async () => {
      await openDemand(2);
      const [imported] = await importOpenDemands(context());
      if (!imported) throw new Error('nothing imported');
      await makeDonor();
      await sendWave(context(), imported.botRequestId);

      const first = await closeDemand(context(), imported.botRequestId, 'cancelled');
      const second = await closeDemand(context(), imported.botRequestId, 'cancelled');
      const third = await closeDemand(context(), imported.botRequestId, 'expired');

      expect(first.ok && first.value.closed).toBe(true);
      // Idempotent: the conditional UPDATE matches only an open or fulfilled
      // request, so a repeat closes nothing and queues nothing.
      expect(second.ok && second.value.closed).toBe(false);
      expect(third.ok && third.value.closed).toBe(false);

      const queued = await db
        .select()
        .from(bot.messageOutbox)
        .where(eq(bot.messageOutbox.kind, 'stand_down'));
      expect(queued).toHaveLength(1);
    });

    it('does not stand down somebody who already declined or was deferred', async () => {
      await openDemand(3);
      const [imported] = await importOpenDemands(context());
      if (!imported) throw new Error('nothing imported');

      const decliner = await makeDonor();
      await makeDonor();
      await sendWave(context(), imported.botRequestId);

      await declineRequest(context(), await journeyFor(imported.botRequestId, decliner.donorId));

      const result = await closeDemand(context(), imported.botRequestId, 'cancelled');
      // Somebody who said no is not waiting for anything, and messaging them
      // about a request they already turned down is noise.
      expect(result.ok && result.value.standDowns).toBe(1);
    });

    it('surfaces a stand-down the drain never managed to send (§11.9)', async () => {
      await openDemand(2);
      const [imported] = await importOpenDemands(context());
      if (!imported) throw new Error('nothing imported');
      await makeDonor();
      await sendWave(context(), imported.botRequestId);
      await closeDemand(context(), imported.botRequestId, 'cancelled');

      // The alert is a query, because a demand that failed to stand its donors
      // down looks exactly like one that succeeded.
      expect(await countStuckStandDowns(context(), 0)).toBeGreaterThanOrEqual(1);

      channel.failNext(10);
      await drainOutbox(context());
      expect(await countStuckStandDowns(context(), 0)).toBeGreaterThanOrEqual(1);

      channel.failNext(0);
      // Back-dated with the *injected* clock, not the database's now(): the
      // drain decides what is due from `ctx.clock`, and a row stamped from the
      // wall clock is a row measured against a different timeline.
      await client`UPDATE bot.message_outbox
                      SET next_attempt_at = ${clock.now().toISOString()}::timestamptz`;
      await drainOutbox(context());
      expect(await countStuckStandDowns(context(), 0)).toBe(0);
    });

    it('abandons a message to somebody who has blocked the bot', async () => {
      await openDemand(2);
      const [imported] = await importOpenDemands(context());
      if (!imported) throw new Error('nothing imported');
      await makeDonor();
      await sendWave(context(), imported.botRequestId);

      channel.failNext(10, true);
      const drain = await drainOutbox(context());

      // Retrying a block forever fills the queue with undeliverable messages
      // and buries the ones that could still go out.
      expect(drain.abandoned).toBeGreaterThanOrEqual(1);
      const rows = await db.select().from(bot.messageOutbox);
      expect(rows.some((row) => row.status === 'abandoned')).toBe(true);
    });
  });

  /* ==================================================================== */
  /* §7.3 — the last unit                                                  */
  /* ==================================================================== */

  describe('claiming the last unit (§7.3)', () => {
    it('confirms exactly one of two donors finishing at the same instant', async () => {
      await openDemand(1);
      const [imported] = await importOpenDemands(context());
      if (!imported) throw new Error('nothing imported');

      const a = await makeDonor();
      const b = await makeDonor();
      await sendWave(context(), imported.botRequestId);

      const journeyA = await journeyFor(imported.botRequestId, a.donorId);
      const journeyB = await journeyFor(imported.botRequestId, b.donorId);

      // Both through the questionnaire, then the final answer at the same time.
      await acceptRequest(context(), journeyA);
      await acceptRequest(context(), journeyB);
      const { questionAt } = await import('../screening.js');
      for (let i = 0; i < QUESTION_COUNT - 1; i += 1) {
        const q = questionAt(i);
        await answerScreeningQuestion(context(), journeyA, i, q?.proceedOn ?? 'yes');
        await answerScreeningQuestion(context(), journeyB, i, q?.proceedOn ?? 'yes');
      }

      const last = questionAt(QUESTION_COUNT - 1);
      const [resultA, resultB] = await Promise.all([
        answerScreeningQuestion(context(), journeyA, QUESTION_COUNT - 1, last?.proceedOn ?? 'no'),
        answerScreeningQuestion(context(), journeyB, QUESTION_COUNT - 1, last?.proceedOn ?? 'no'),
      ]);

      const kinds = [resultA, resultB].map((r) => (r.ok ? r.value.kind : 'error'));
      expect(kinds.filter((k) => k === 'confirmed')).toHaveLength(1);
      expect(kinds.filter((k) => k === 'waitlisted')).toHaveLength(1);

      const [request] = await db
        .select()
        .from(bot.botRequests)
        .where(eq(bot.botRequests.id, imported.botRequestId));
      // Never above what was asked for. The CHECK would refuse it anyway.
      expect(request?.confirmedCount).toBe(1);
      expect(request?.waitlistedCount).toBe(1);
      expect(request?.status).toBe('fulfilled');
    });

    it('writes exactly one roster row for the confirmed donor', async () => {
      const demandId = await openDemand(1);
      const [imported] = await importOpenDemands(context());
      if (!imported) throw new Error('nothing imported');
      const donor = await makeDonor();
      await sendWave(context(), imported.botRequestId);
      await passScreening(await journeyFor(imported.botRequestId, donor.donorId));

      const roster = await db
        .select()
        .from(donorDemandConfirmations)
        .where(eq(donorDemandConfirmations.demandId, demandId));

      expect(roster).toHaveLength(1);
      // The bot's internal donor id, never a platform user id (§2.11).
      expect(roster[0]?.donorId).toBe(donor.donorId);
      expect(roster[0]?.status).toBe('confirmed');
      expect(roster[0]?.donorPhone).toMatch(/^\+91/);
    });

    it('tells the loser it is good news, not that they were too slow', async () => {
      await openDemand(1);
      const [imported] = await importOpenDemands(context());
      if (!imported) throw new Error('nothing imported');
      const a = await makeDonor();
      const b = await makeDonor();
      await sendWave(context(), imported.botRequestId);

      await passScreening(await journeyFor(imported.botRequestId, a.donorId));
      const loser = await passScreening(await journeyFor(imported.botRequestId, b.donorId));

      expect(loser).toMatchObject({ ok: true, value: { kind: 'waitlisted' } });
    });

    it('promotes from the waitlist when a place is freed', async () => {
      const demandId = await openDemand(1);
      const [imported] = await importOpenDemands(context());
      if (!imported) throw new Error('nothing imported');
      const a = await makeDonor();
      const b = await makeDonor();
      await sendWave(context(), imported.botRequestId);

      await passScreening(await journeyFor(imported.botRequestId, a.donorId));
      await passScreening(await journeyFor(imported.botRequestId, b.donorId));

      // The counter marks the first donor a no-show, which frees the unit.
      await client`UPDATE hospital.donor_demand_confirmations
                      SET status = 'no_show'
                    WHERE demand_id = ${demandId} AND donor_id = ${a.donorId}`;
      await applyCounterOutcomes(context());

      const promoted = await promoteFromWaitlist(context(), imported.botRequestId);
      // A waitlist that never resolves is worse than never offering one (§5).
      expect(promoted.promoted).toBe(1);

      const [journey] = await db
        .select()
        .from(bot.donorRequests)
        .where(
          and(
            eq(bot.donorRequests.botRequestId, imported.botRequestId),
            eq(bot.donorRequests.donorId, b.donorId),
          ),
        );
      expect(journey?.status).toBe('CONFIRMED');
    });
  });

  /* ==================================================================== */
  /* §7.4 — replays                                                        */
  /* ==================================================================== */

  describe('replayed callbacks (§7.4)', () => {
    it('makes a second accept a no-op', async () => {
      await openDemand(2);
      const [imported] = await importOpenDemands(context());
      if (!imported) throw new Error('nothing imported');
      const donor = await makeDonor();
      await sendWave(context(), imported.botRequestId);
      const journeyId = await journeyFor(imported.botRequestId, donor.donorId);

      const first = await acceptRequest(context(), journeyId);
      const second = await acceptRequest(context(), journeyId);

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.error.kind).toBe('AlreadyMoved');
    });

    it('recognises a duplicate tap on question three as already answered', async () => {
      await openDemand(2);
      const [imported] = await importOpenDemands(context());
      if (!imported) throw new Error('nothing imported');
      const donor = await makeDonor();
      await sendWave(context(), imported.botRequestId);
      const journeyId = await journeyFor(imported.botRequestId, donor.donorId);

      const { questionAt } = await import('../screening.js');
      await acceptRequest(context(), journeyId);
      for (let i = 0; i < 3; i += 1) {
        await answerScreeningQuestion(context(), journeyId, i, questionAt(i)?.proceedOn ?? 'yes');
      }

      // The index is compared against the row, not against session memory —
      // which is why this survives a restart as well as a redelivery.
      const replay = await answerScreeningQuestion(context(), journeyId, 2, 'yes');
      expect(replay.ok).toBe(false);
      if (!replay.ok) expect(replay.error.kind).toBe('AlreadyMoved');
    });

    it('cannot decline a request already accepted', async () => {
      await openDemand(2);
      const [imported] = await importOpenDemands(context());
      if (!imported) throw new Error('nothing imported');
      const donor = await makeDonor();
      await sendWave(context(), imported.botRequestId);
      const journeyId = await journeyFor(imported.botRequestId, donor.donorId);

      await acceptRequest(context(), journeyId);
      const declined = await declineRequest(context(), journeyId);
      expect(declined.ok).toBe(false);
    });
  });

  /* ==================================================================== */
  /* Import                                                                */
  /* ==================================================================== */

  describe('importing demand (§8.4)', () => {
    it('never fans out the same demand twice', async () => {
      await openDemand(2);

      const [first, second] = await Promise.all([
        importOpenDemands(context()),
        importOpenDemands(context()),
      ]);

      expect(first.length + second.length).toBe(1);
      expect(await db.select().from(bot.botRequests)).toHaveLength(1);
    });

    it('writes the deep-link id back onto the demand and nothing else', async () => {
      const demandId = await openDemand(4);
      const [imported] = await importOpenDemands(context());
      if (!imported) throw new Error('nothing imported');

      const [demand] = await db
        .select()
        .from(donorDemand)
        .where(eq(donorDemand.id, demandId));

      expect(demand?.botPublicId).toBe(imported.publicId);
      expect(demand?.importedAt).not.toBeNull();
      // The centre's columns are untouched: the bot cannot change what was
      // asked for, and holds no grant to try.
      expect(demand?.units).toBe(4);
      expect(demand?.status).toBe('open');
    });

    it('freezes what donors are told at import (§2.6)', async () => {
      const demandId = await openDemand(2);
      const [imported] = await importOpenDemands(context());
      if (!imported) throw new Error('nothing imported');

      await client`UPDATE hospital.donor_demand SET hospital_name = 'Renamed'
                    WHERE id = ${demandId}`;

      const [request] = await db
        .select()
        .from(bot.botRequests)
        .where(eq(bot.botRequests.id, imported.botRequestId));

      const snapshot = request?.hospitalSnapshot as { hospitalName: string };
      expect(snapshot.hospitalName).toBe('Test centre');
    });
  });

  /* ==================================================================== */
  /* §7.7 — the predicate that exists twice                                */
  /* ==================================================================== */

  describe('wave selection, and the predicate that exists twice (§7.7, §11.3)', () => {
    it('agrees with the TypeScript reading on every boundary', async () => {
      const today = clock.today();
      const { minAge, maxAge, minWeightKg } = CONFIG_DEFAULTS.donor;

      // Every boundary the spec names, plus the exclusions.
      // Exact birthdays, not day arithmetic: "65 years ago" is not 65 * 365
      // days, and a boundary test that is a few days out tests nothing.
      const yearsAgo = (years: number): CalendarDay => {
        const [y, m, d] = today.split('-');
        const value = `${String(Number(y) - years)}-${m ?? '01'}-${d ?? '01'}`;
        const parsed = parseCalendarDay(value);
        if (!parsed) throw new Error(`bad birth date: ${value}`);
        return parsed;
      };

      const cases = [
        { label: 'exactly the minimum age today', dob: yearsAgo(minAge) },
        { label: 'one day short of the minimum age', dob: addDays(yearsAgo(minAge), 1) },
        { label: 'exactly the maximum age today', dob: yearsAgo(maxAge) },
        { label: 'one day past the maximum age', dob: subtractDays(yearsAgo(maxAge), 1) },
        { label: 'exactly at the weight threshold', weightKg: minWeightKg },
        { label: 'one kilo under the threshold', weightKg: minWeightKg - 1 },
        { label: 'eligible today', nextEligibleOn: today },
        { label: 'eligible tomorrow', nextEligibleOn: addDays(today, 1) },
        { label: 'eligible yesterday', nextEligibleOn: subtractDays(today, 1) },
        { label: 'unverified group', verified: false },
        { label: 'no current consent', consent: false },
        { label: 'opted out', optedOut: true },
        { label: 'durably flagged', flagged: true },
        { label: 'snoozed until next month', snoozeUntil: addDays(today, 30) },
        { label: 'snooze ended', snoozeUntil: subtractDays(today, 1) },
      ] as const;

      const made: { label: string; donorId: string }[] = [];
      for (const each of cases) {
        const { label, ...overrides } = each;
        const donor = await makeDonor(overrides);
        made.push({ label, donorId: donor.donorId });
      }

      await openDemand(50);
      const [imported] = await importOpenDemands(context());
      if (!imported) throw new Error('nothing imported');

      const selected = await selectWave(
        context(),
        imported.botRequestId,
        'O+',
        { districtId: DISTRICT_ID, cityId: null, townId: null, localityId: null },
        100,
      );
      const bySql = new Set(selected.map((row) => row.donorId));

      const rows = await db.select().from(bot.donors);
      const byTypeScript = new Set(
        rows
          .filter((row) =>
            isEligible(
              {
                bloodGroup: row.bloodGroup,
                bloodGroupVerifiedAt: row.bloodGroupVerifiedAt,
                dob: row.dob,
                weightKg: row.weightKg,
                nextEligibleOn: row.nextEligibleOn,
                durableFlagStatus: row.durableFlagStatus,
                snoozeUntil: row.snoozeUntil,
                optedOutAt: row.optedOutAt,
                deletedAt: row.deletedAt,
                consentCurrentAt: row.consentCurrentAt,
              },
              'O+',
              today,
              CONFIG_DEFAULTS,
            ),
          )
          .map((row) => row.id),
      );

      // The agreement test §11.3 makes mandatory. A revised threshold that moved
      // one reading and not the other would fail here rather than in production.
      const disagreements = made.filter(
        ({ donorId }) => bySql.has(donorId) !== byTypeScript.has(donorId),
      );
      expect(disagreements.map((d) => d.label)).toEqual([]);
      expect(bySql.size).toBe(byTypeScript.size);
      expect(bySql.size).toBeGreaterThan(0);
    });

    it('asks a donor once per request, however many waves run', async () => {
      await openDemand(20);
      const [imported] = await importOpenDemands(context());
      if (!imported) throw new Error('nothing imported');
      await makeDonor();

      await sendWave(context(), imported.botRequestId);
      const second = await sendWave(context(), imported.botRequestId);

      expect(second?.notified).toBe(0);
      expect(await db.select().from(bot.donorRequests)).toHaveLength(1);
    });

    it('prefers the nearest tier', async () => {
      const far = await makeDonor({ districtId: null });
      const near = await makeDonor({ districtId: DISTRICT_ID });

      await openDemand(20);
      const [imported] = await importOpenDemands(context());
      if (!imported) throw new Error('nothing imported');

      const selected = await selectWave(
        context(),
        imported.botRequestId,
        'O+',
        { districtId: DISTRICT_ID, cityId: null, townId: null, localityId: null },
        10,
      );

      expect(selected[0]?.donorId).toBe(near.donorId);
      expect(selected.map((r) => r.donorId)).toContain(far.donorId);
    });

    it('stops scheduling waves once the request is filled', async () => {
      await openDemand(1);
      const [imported] = await importOpenDemands(context());
      if (!imported) throw new Error('nothing imported');
      const donor = await makeDonor();
      await sendWave(context(), imported.botRequestId);
      await passScreening(await journeyFor(imported.botRequestId, donor.donorId));

      const [request] = await db
        .select()
        .from(bot.botRequests)
        .where(eq(bot.botRequests.id, imported.botRequestId));

      expect(request?.status).toBe('fulfilled');
      // A filled request with a wave still scheduled would message people about
      // a place that no longer exists.
      expect(request?.nextWaveAt).toBeNull();
    });
  });

  /* ==================================================================== */
  /* The loop, end to end                                                  */
  /* ==================================================================== */

  describe('the whole loop', () => {
    it('runs from demand to a thanked donor with the interval rolled forward', async () => {
      const demandId = await openDemand(1);

      const [imported] = await importOpenDemands(context());
      if (!imported) throw new Error('nothing imported');

      const donor = await makeDonor();
      const wave = await sendWave(context(), imported.botRequestId);
      expect(wave?.notified).toBe(1);

      const confirmed = await passScreening(
        await journeyFor(imported.botRequestId, donor.donorId),
      );
      expect(confirmed).toMatchObject({ ok: true, value: { kind: 'confirmed' } });

      // The counter is the authority on who gave blood (§4).
      await client`UPDATE hospital.donor_demand_confirmations
                      SET status = 'completed', donated_at = ${clock.today()},
                          bag_identifier = 'SYN-E2E'
                    WHERE demand_id = ${demandId} AND donor_id = ${donor.donorId}`;

      const outcomes = await applyCounterOutcomes(context());
      expect(outcomes.completed).toBe(1);

      const [row] = await db
        .select()
        .from(bot.donors)
        .where(eq(bot.donors.id, donor.donorId));

      expect(row?.lastDonatedOn).toBe(clock.today());
      // 90 days for a male donor, from the configured interval — never a
      // constant in the use case.
      expect(row?.nextEligibleOn).toBe(
        addDays(clock.today(), CONFIG_DEFAULTS.donor.intervalDays.male),
      );

      await drainOutbox(context());
      const thanks = channel
        .to(donor.channelUserId)
        .find((m) => m.text.startsWith('Thank you — the centre has recorded'));
      expect(thanks).toBeDefined();
      // The date a person reads, not an ISO string: "7 Dec", not "2026-12-07".
      expect(thanks?.text).toContain(readableDay(row?.nextEligibleOn ?? ''));
    });

    it('applies a counter outcome only once', async () => {
      const demandId = await openDemand(1);
      const [imported] = await importOpenDemands(context());
      if (!imported) throw new Error('nothing imported');
      const donor = await makeDonor();
      await sendWave(context(), imported.botRequestId);
      await passScreening(await journeyFor(imported.botRequestId, donor.donorId));

      await client`UPDATE hospital.donor_demand_confirmations
                      SET status = 'completed', donated_at = ${clock.today()}
                    WHERE demand_id = ${demandId}`;

      const first = await applyCounterOutcomes(context());
      const second = await applyCounterOutcomes(context());

      expect(first.processed).toBe(1);
      // `acknowledged_at` is the marker, so a second pass rolls no interval
      // forward twice and thanks nobody twice.
      expect(second.processed).toBe(0);
    });

    it('picks up a cancellation the centre made', async () => {
      const demandId = await openDemand(2);
      const [imported] = await importOpenDemands(context());
      if (!imported) throw new Error('nothing imported');
      await makeDonor();
      await sendWave(context(), imported.botRequestId);

      // The centre sets the status and stops — it cannot reach the donors (§8.3).
      await client`UPDATE hospital.donor_demand SET status = 'cancelled'
                    WHERE id = ${demandId}`;

      const found = await findCancelledDemands(context());
      expect(found.map((f) => f.botRequestId)).toContain(imported.botRequestId);

      const closed = await closeDemand(context(), imported.botRequestId, 'cancelled');
      expect(closed.ok && closed.value.standDowns).toBe(1);
    });

    it('writes progress back on the columns the bot owns', async () => {
      const demandId = await openDemand(2);
      const [imported] = await importOpenDemands(context());
      if (!imported) throw new Error('nothing imported');
      const donor = await makeDonor();
      await sendWave(context(), imported.botRequestId);
      await passScreening(await journeyFor(imported.botRequestId, donor.donorId));

      const { writeBackProgress } = await import('./import-demand.js');
      await writeBackProgress(context(), imported.botRequestId);

      const [demand] = await db
        .select()
        .from(donorDemand)
        .where(eq(donorDemand.id, demandId));

      expect(demand?.donorsNotified).toBe(1);
      expect(demand?.confirmedUnits).toBe(1);
      // Still exactly what the centre asked for.
      expect(demand?.units).toBe(2);
    });

    it('logs no name, phone number or screening answer (§11.9, §12)', async () => {
      await openDemand(1);
      const [imported] = await importOpenDemands(context());
      if (!imported) throw new Error('nothing imported');
      const donor = await makeDonor();
      await sendWave(context(), imported.botRequestId);
      await passScreening(await journeyFor(imported.botRequestId, donor.donorId));
      await closeDemand(context(), imported.botRequestId, 'cancelled');

      const [row] = await db
        .select({ name: bot.donors.name })
        .from(bot.donors)
        .where(eq(bot.donors.id, donor.donorId));

      const events = await db.select().from(bot.eventLog);
      const dumped = JSON.stringify(events);

      // The log outlives the incident it documents, and a name in it is a name
      // with a long tail.
      expect(dumped).not.toContain(row?.name ?? 'IMPOSSIBLE');
      expect(dumped).not.toContain('+9199');
      expect(dumped).toContain(donor.donorId);
    });

    it('keeps the event log append-only for the bot role', async () => {
      const botUrl = new URL(testUrl ?? '');
      botUrl.username = 'app_bot';
      botUrl.password = 'app_bot';
      const asBot = postgres(botUrl.toString(), { max: 1, onnotice: () => undefined });

      try {
        await openDemand(1);
        const [imported] = await importOpenDemands(context());
        if (!imported) throw new Error('nothing imported');

        await expect(asBot`DELETE FROM bot.event_log`).rejects.toThrow(/permission denied/i);
        await expect(
          asBot`UPDATE bot.event_log SET event = 'rewritten'`,
        ).rejects.toThrow(/permission denied/i);

        // And the privacy boundary in the other direction (§5.1).
        await expect(asBot`SELECT count(*) FROM hospital.patients`).rejects.toThrow(
          /permission denied/i,
        );
      } finally {
        await asBot.end({ timeout: 5 });
      }
    });

    it('does not let the web role read the donor pool at all (§5.1)', async () => {
      const webUrl = new URL(testUrl ?? '');
      webUrl.username = 'app_web';
      webUrl.password = 'app_web';
      const asWeb = postgres(webUrl.toString(), { max: 1, onnotice: () => undefined });

      try {
        // The centre sees a donor's name on the roster row it was given, and
        // nowhere else. This is the missing grant that makes that true.
        await expect(asWeb`SELECT count(*) FROM bot.donors`).rejects.toThrow(
          /permission denied/i,
        );
        await expect(asWeb`SELECT count(*) FROM bot.donor_phones`).rejects.toThrow(
          /permission denied/i,
        );
      } finally {
        await asWeb.end({ timeout: 5 });
      }
    });
  });

  it('leaves the counter honest about how many were notified', async () => {
    await openDemand(5);
    const [imported] = await importOpenDemands(context());
    if (!imported) throw new Error('nothing imported');
    for (let i = 0; i < 3; i += 1) await makeDonor();

    await sendWave(context(), imported.botRequestId);

    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(bot.donorRequests)
      .where(eq(bot.donorRequests.botRequestId, imported.botRequestId));

    expect(count?.n).toBe(3);
  });
});
