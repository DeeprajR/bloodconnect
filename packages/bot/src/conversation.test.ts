import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { CONFIG_DEFAULTS } from '@blood-connect/config';
import * as bot from '@blood-connect/db/bot';
import { addDays } from '@blood-connect/domain';
import { idGenerator, newId } from '@blood-connect/ids';
import { createFakeClock } from '@blood-connect/testing';

import { createMemoryChannel, type MemoryChannel } from './adapters/memory-channel.js';
import { createChannelRegistry } from './ports/channel.js';
import type { BotContext } from './context.js';
import type { BotDatabase } from './db.js';
import { handleUpdate } from './conversation.js';
import { drainOutbox } from './outbox.js';
import type { IncomingUpdate } from './ports/channel.js';

const testUrl = process.env['TEST_DATABASE_URL'];
const CENTRE_ID = '01930000-0000-7000-8000-000000000001';
const DISTRICT_ID = 'TEST_CONV_DISTRICT';

/**
 * The conversation, as somebody actually experiences it.
 *
 * This file exists because of a specific bad experience: a person finished
 * registering, was told "You are registered", and was immediately told "You are
 * not registered yet. Send start…" followed by a command menu. The router fell
 * through to the onboarding handler for any unrecognised message, and with the
 * conversation row deleted on success it concluded they had never begun.
 *
 * So these tests assert the *transcript*, not the internals — the thing a person
 * reads, in the order they read it.
 */
describe.skipIf(!testUrl)('the conversation', () => {
  const client = postgres(testUrl ?? '', { max: 8, onnotice: () => undefined });
  const db = drizzle(client, { schema: bot }) as unknown as BotDatabase;
  const clock = createFakeClock('2026-09-09T09:00:00.000Z');
  let channel: MemoryChannel;
  let updateSeq = 0;

  const context = (): BotContext => ({
    db,
    clock,
    ids: idGenerator,
    channel: createChannelRegistry(channel),
    config: CONFIG_DEFAULTS,
    correlationId: newId(),
  });

  const WHO = { channel: 'memory', channelUserId: 'conv-1' };

  /** Sends a message and returns everything the bot said back, in order. */
  async function say(text: string): Promise<string[]> {
    updateSeq += 1;
    const before = channel.sent.length;
    const update: IncomingUpdate = {
      kind: 'text',
      address: WHO,
      text,
      updateId: `u${String(updateSeq)}`,
    };
    await handleUpdate(context(), update);
    await drainOutbox(context(), 50);
    return channel.sent.slice(before).map((m) => m.message.text);
  }

  /** Taps a button. */
  async function tap(data: string): Promise<string[]> {
    updateSeq += 1;
    const before = channel.sent.length;
    await handleUpdate(context(), {
      kind: 'choice',
      address: WHO,
      data,
      messageRef: 'm1',
      updateId: `u${String(updateSeq)}`,
    });
    await drainOutbox(context(), 50);
    return channel.sent.slice(before).map((m) => m.message.text);
  }

  /** The whole interview, in the order a person walks it. */
  async function register(): Promise<string[]> {
    await say('hello');
    await say('Priya');
    await say('+919876543210');
    await say('1994-03-12');
    await tap('sex:female');
    await tap('group:O-');
    await tap('weight:50_60');
    await tap(`district:${DISTRICT_ID}`);
    return tap('consent:yes');
  }

  beforeEach(async () => {
    channel = createMemoryChannel();
    updateSeq = 0;
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
                 VALUES (${DISTRICT_ID}, 'district', 'district', NULL, 'Conv District',
                         'conv district', 'test')
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

  /* ==================================================================== */

  it('starts the interview without anybody typing a command', async () => {
    // Whatever a new person says, the useful reply is the welcome and the first
    // question. Requiring `/start` is a step that exists for the system.
    const said = await say('hi');

    expect(said).toHaveLength(2);
    expect(said[0]).toContain('Blood Connect asks people nearby');
    expect(said[1]).toBe('What should we call you?');
  });

  it('asks one question at a time, and each one is a question', async () => {
    await say('hello');
    expect(await say('Priya')).toEqual(['Your phone number, please.\n\nOnly the blood centre sees it, and only once you have agreed to give for a particular patient.']);
    expect((await say('+919876543210'))[0]).toContain('date of birth');
    expect((await say('1994-03-12'))[0]).toContain('male or female');
  });

  it('never tells somebody who just registered that they are not registered', async () => {
    const said = await register();

    // The exact bug: "You are registered" followed by "You are not registered
    // yet" followed by a command menu.
    const transcript = said.join('\n');
    expect(transcript).toContain('Thank you, Priya. You are registered.');
    expect(transcript).not.toContain('not registered');
    expect(transcript).not.toContain('Send "start"');
  });

  it('follows the confirmation with something to do', async () => {
    const said = await register();

    expect(said).toHaveLength(2);
    // "You are registered" alone leaves somebody with no idea whether anything
    // will ever happen.
    expect(said[1]).toContain('O−');
  });

  it('answers a registered donor with their own situation, not a menu', async () => {
    await register();
    const said = await say('anything at all');

    expect(said).toHaveLength(1);
    expect(said[0]).not.toContain('not registered');
    expect(said[0]).toContain('Nothing is needed right now');
  });

  it('lists what is open for their group, and only what they could answer', async () => {
    await register();

    // O− gives to everyone, so both of these are answerable. Whole blood only.
    await openRequest('AB+', 2, 'Kozhikode General');
    await openRequest('O-', 1, 'Kozhikode General');

    const said = await say('needs');
    expect(said[0]).toContain('2 requests are open near you');
    expect(said[0]).toContain('AB+');
    expect(said[0]).toContain('O−');
  });

  it('does not list a request this donor could not answer', async () => {
    /**
     * The compatibility direction, which is easy to get backwards.
     *
     * An AB+ donor's red cells can only go to an AB+ patient. So an O− request
     * must not appear on their list — showing it would invite somebody to
     * travel to a hospital that cannot use their blood.
     */
    await say('hello');
    await say('Arun');
    await say('+919876500000');
    await say('1990-01-20');
    await tap('sex:male');
    await tap('group:AB+');
    await tap('weight:60_70');
    await tap(`district:${DISTRICT_ID}`);
    await tap('consent:yes');

    await openRequest('O-', 1, 'Kozhikode General');
    await openRequest('AB+', 2, 'Kozhikode General');

    const said = await say('needs');
    expect(said[0]).toContain('One request is open near you');
    expect(said[0]).toContain('AB+');
    expect(said[0]).not.toContain('O−');
  });

  it('marks a request this donor has already been messaged about', async () => {
    await register();
    await openRequest('O-', 2, 'Kozhikode General');

    const [request] = await db.select().from(bot.botRequests);
    const [donor] = await db.select().from(bot.donors);
    await db.insert(bot.donorRequests).values({
      id: newId(),
      botRequestId: request?.id ?? '',
      donorId: donor?.id ?? '',
      status: 'NOTIFIED',
      waveNo: 1,
      notifiedAt: clock.now(),
    });

    /**
     * This flag was silently always false.
     *
     * The correlated subquery interpolated the column through Drizzle, which
     * renders it unqualified inside a select-list `sql` — so it compared the
     * journey row's id against itself and never matched. Nothing errored.
     */
    const said = await say('needs');
    expect(said[0]).toContain('already messaged you');
  });

  it('says why it is quiet when the donor is inside their interval', async () => {
    await register();
    await db
      .update(bot.donors)
      .set({ lastDonatedOn: clock.today(), nextEligibleOn: addDays(clock.today(), 90) })
      .where(eq(bot.donors.name, 'Priya'));

    const said = await say('needs');
    // An empty list on its own reads as "nobody needs blood", which is not what
    // it means.
    expect(said[0]).toContain('You can give again from');
  });

  it('pauses and resumes politely', async () => {
    await register();

    const paused = await say('pause');
    expect(paused[0]).toContain('we will not ask again until');

    const status = await say('needs');
    expect(status[0]).toContain('You are paused until');

    const resumed = await say('resume');
    expect(resumed[0]).toContain('Welcome back');

    const [donor] = await db.select().from(bot.donors);
    expect(donor?.snoozeUntil).toBeNull();
  });

  it('says plainly what deletion does before doing it', async () => {
    await register();

    const asked = await say('delete');
    expect(asked[0]).toContain('cannot be undone');
    // Named before the button, not after it (§5).
    expect(asked[0]).toContain('permanently deletes');

    const [donor] = await db.select().from(bot.donors);
    expect(donor?.deletedAt).toBeNull();
  });

  it('re-asks the same question when an answer will not do', async () => {
    await say('hello');
    await say('Priya');

    const said = await say('not a phone number');
    expect(said).toHaveLength(2);
    expect(said[0]).toContain('does not look like a phone number');
    // The prompt comes back with it — an error with no question leaves somebody
    // unsure whether to answer again or start over.
    expect(said[1]).toContain('phone number');
  });

  it('keeps a half-finished interview across a restart', async () => {
    await say('hello');
    await say('Priya');

    // Nothing is held in the process: a new context is a new "process".
    const said = await say('+919876543210');
    expect(said[0]).toContain('date of birth');

    const [state] = await db.select().from(bot.conversationState);
    expect(state?.step).toBe('dob');
    // And nothing is committed until consent.
    expect(await db.select().from(bot.donors)).toHaveLength(0);
  });

  it('treats "start" from a registered donor as a return, not a re-registration', async () => {
    await register();
    const said = await say('start');

    expect(said[0]).toContain('Welcome back');
    // One donor, not two.
    expect(await db.select().from(bot.donors)).toHaveLength(1);
  });

  async function openRequest(group: string, units: number, hospital: string): Promise<void> {
    const demandId = newId();
    await client`INSERT INTO hospital.donor_demand
                   (id, centre_id, trigger, blood_group, product, units, date_required,
                    hospital_name, hospital_address, district_id, status)
                 VALUES (${demandId}, ${CENTRE_ID}, 'stock_floor', ${group}, 'whole_blood',
                         ${units}, ${addDays(clock.today(), 3)}, ${hospital}, 'An address',
                         ${DISTRICT_ID}, 'open')`;

    await db.insert(bot.botRequests).values({
      id: newId(),
      demandId,
      publicId: `BC-${newId().slice(-6).toUpperCase()}`,
      bloodGroup: group,
      product: 'whole_blood',
      unitsNeeded: units,
      neededBy: addDays(clock.today(), 3),
      hospitalSnapshot: { hospitalName: hospital, hospitalAddress: 'An address' },
      status: 'open',
    });
  }
});
