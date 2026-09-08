import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { CONFIG_DEFAULTS } from '@blood-connect/config';
import * as bot from '@blood-connect/db/bot';
import { donorDemand } from '@blood-connect/db';
import { addDays, subtractDays } from '@blood-connect/domain';
import { idGenerator, newId } from '@blood-connect/ids';
import { createFakeClock } from '@blood-connect/testing';

import { createMemoryChannel, type MemoryChannel } from './adapters/memory-channel.js';
import { createChannelRegistry } from './ports/channel.js';
import type { BotContext } from './context.js';
import type { BotDatabase } from './db.js';
import { tick } from './ticker.js';

const testUrl = process.env['TEST_DATABASE_URL'];
const CENTRE_ID = '01930000-0000-7000-8000-000000000001';
const DISTRICT_ID = 'TEST_TICK_DISTRICT';

/**
 * The ticker, end to end (§11.2).
 *
 * This file exists because of a bug it would have caught and the use-case suite
 * did not: `findRequestsDueAWave` interpolated a JavaScript `Date` into a raw
 * `sql` template, which the driver cannot bind. Every use case passed, because
 * every test called them directly — nothing ran the poll that the *process*
 * runs. A unit suite that never exercises the caller proves the callee and
 * nothing else.
 */
describe.skipIf(!testUrl)('the ticker', () => {
  const client = postgres(testUrl ?? '', { max: 8, onnotice: () => undefined });
  const db = drizzle(client, { schema: bot }) as unknown as BotDatabase;
  const clock = createFakeClock('2026-09-08T09:00:00.000Z');
  let channel: MemoryChannel;

  const context = (): BotContext => ({
    db,
    clock,
    ids: idGenerator,
    channel: createChannelRegistry(channel),
    config: CONFIG_DEFAULTS,
    correlationId: newId(),
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
                 VALUES (${DISTRICT_ID}, 'district', 'district', NULL, 'Tick District',
                         'tick district', 'test')
                 ON CONFLICT (id) DO NOTHING`;
  });

  afterAll(async () => {
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

  async function openDemand(units = 2, dateRequired = addDays(clock.today(), 2)): Promise<string> {
    const id = newId();
    await client`INSERT INTO hospital.donor_demand
                   (id, centre_id, trigger, blood_group, product, units, date_required,
                    hospital_name, hospital_address, district_id, status)
                 VALUES (${id}, ${CENTRE_ID}, 'stock_floor', 'O+', 'whole_blood', ${units},
                         ${dateRequired}, 'Test centre', 'Test address', ${DISTRICT_ID}, 'open')`;
    return id;
  }

  async function makeDonor(index: number): Promise<string> {
    const donorId = newId();
    await db.insert(bot.donors).values({
      id: donorId,
      name: `Tick Donor ${String(index)}`,
      dob: '1990-06-15',
      sex: 'male',
      bloodGroup: 'O+',
      bloodGroupVerifiedAt: clock.now(),
      weightBand: '60_70',
      weightKg: 65,
      districtId: DISTRICT_ID,
      durableFlagStatus: 'clear',
      consentCurrentAt: clock.now(),
    });
    await db.insert(bot.donorChannels).values({
      donorId,
      channel: 'memory',
      channelUserId: `tick-${donorId}`,
    });
    await db.insert(bot.donorPhones).values({
      donorId,
      e164: `+91980000${String(1000 + index)}`,
      verified: true,
      verifiedAt: clock.now(),
    });
    return donorId;
  }

  it('imports, waves and drains in one pass', async () => {
    await openDemand(2);
    await makeDonor(1);
    await makeDonor(2);

    const result = await tick(context());

    // Each of these is a separate poll, and the `Date`-binding bug made the
    // wave poll throw before any of the rest ran.
    expect(result.imported).toBe(1);
    expect(result.wavesSent).toBe(1);
    expect(result.donorsNotified).toBe(2);
    expect(result.drain.sent).toBe(2);
    expect(channel.sent).toHaveLength(2);
  });

  it('does nothing on a second pass with nothing new', async () => {
    await openDemand(2);
    await makeDonor(1);
    await tick(context());

    const second = await tick(context());

    // The wave interval has not elapsed on the fake clock, the demand is
    // already imported, and the outbox is empty. A ticker that did work here
    // would be sending somebody a second copy of the same card.
    expect(second.imported).toBe(0);
    expect(second.wavesSent).toBe(0);
    expect(second.drain.sent).toBe(0);
  });

  it('stands donors down when the centre withdraws a demand', async () => {
    const demandId = await openDemand(2);
    await makeDonor(1);
    await tick(context());

    await client`UPDATE hospital.donor_demand SET status = 'cancelled' WHERE id = ${demandId}`;

    const result = await tick(context());
    expect(result.cancelled).toBe(1);
    expect(result.standDownsQueued).toBe(1);
    // Queued *and* sent in the same pass — the drain runs last for this reason.
    expect(result.drain.sent).toBe(1);

    const messages = channel.sent.map((m) => m.message.text);
    expect(messages.some((text) => text.includes('no longer needed'))).toBe(true);
  });

  it('closes a demand whose day has passed, and tells the donors', async () => {
    await openDemand(2, subtractDays(clock.today(), 1));
    await makeDonor(1);

    const result = await tick(context());

    // A demand that quietly stays open past the day the blood was needed is a
    // flow with no ending (§8), and the people holding places are never told.
    expect(result.expired).toBe(1);
    expect(result.imported).toBe(1);

    const [demand] = await db.select().from(donorDemand);
    expect(demand?.status).toBe('expired');
  });

  it('survives a pass where the channel is down', async () => {
    await openDemand(2);
    await makeDonor(1);

    channel.failNext(10);
    const failed = await tick(context());
    expect(failed.drain.sent).toBe(0);
    // The work was done and committed; only delivery failed, which is exactly
    // the split the outbox exists to make.
    expect(await db.select().from(bot.donorRequests)).toHaveLength(1);

    channel.failNext(0);
    await client`UPDATE bot.message_outbox
                    SET next_attempt_at = ${clock.now().toISOString()}::timestamptz`;
    const recovered = await tick(context());
    expect(recovered.drain.sent).toBeGreaterThanOrEqual(1);
  });

  it('never sends a message through a channel it was not queued for', async () => {
    await openDemand(2);
    await makeDonor(1);

    // The donors above are on `memory`. This process runs `telegram` only —
    // which is exactly what happened the first time the bot was pointed at a
    // real token with a seeded pool behind it.
    const telegramOnly: BotContext = {
      ...context(),
      channel: createChannelRegistry({
        name: 'telegram',
        send: () => {
          throw new Error('a memory-channel message was routed to Telegram');
        },
        receive: () => Promise.resolve([]),
        check: () => Promise.resolve({ ok: true, detail: 'stub' }),
      }),
    };

    const result = await tick(telegramOnly);

    expect(result.drain.sent).toBe(0);
    // Left pending, not abandoned: the message is fine, the platform is simply
    // not running here, and a process that does run it will deliver it.
    expect(result.drain.skipped).toBeGreaterThanOrEqual(1);

    const [row] = await db.select().from(bot.messageOutbox);
    expect(row?.status).toBe('pending');
    expect(row?.lastError).toContain('no adapter for channel "memory"');
  });

  it('writes progress back to the centre on every pass that touched a request', async () => {
    const demandId = await openDemand(3);
    await makeDonor(1);
    await makeDonor(2);

    await tick(context());

    const [demand] = await db
      .select()
      .from(donorDemand)
      .where(eq(donorDemand.id, demandId));

    expect(demand?.donorsNotified).toBe(2);
    expect(demand?.confirmedUnits).toBe(0);
    // Still exactly what the centre asked for.
    expect(demand?.units).toBe(3);
  });
});
