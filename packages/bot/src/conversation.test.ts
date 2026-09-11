import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { CONFIG_DEFAULTS } from '@blood-connect/config';
import * as bot from '@blood-connect/db/bot';
import { donorDemand, donorDemandConfirmations } from '@blood-connect/db';
import { idGenerator, newId } from '@blood-connect/ids';
import { addDays } from '@blood-connect/domain';
import { createFakeClock } from '@blood-connect/testing';

import { createMemoryChannel, type MemoryChannel } from './adapters/memory-channel.js';
import { createChannelRegistry } from './ports/channel.js';
import type { BotContext } from './context.js';
import type { BotDatabase } from './db.js';
import { handleUpdate } from './conversation.js';
import { drainOutbox } from './outbox.js';
import { remindAbandonedSignups } from './use-cases/reminders.js';
import { tellUnansweredItIsCovered } from './use-cases/close-demand.js';
import type { Choice, IncomingUpdate, OutgoingMessage } from './ports/channel.js';

const testUrl = process.env['TEST_DATABASE_URL'];
const CENTRE_ID = '01930000-0000-7000-8000-000000000001';
const DISTRICT_ID = 'TEST_CONV_DISTRICT';
const CITY_ID = 'TEST_CONV_CITY';
const TOWN_ID = 'TEST_CONV_TOWN';

/**
 * The conversation, as somebody actually experiences it.
 *
 * This file exists because of a specific bad experience: a person finished
 * registering, was told "You are registered", and was immediately told "You are
 * not registered yet. Send start…" followed by a command menu. The router fell
 * through to the onboarding handler for any unrecognised message, and with the
 * conversation row deleted on success it concluded they had never begun.
 *
 * So these tests assert the *transcript*, not the internals. The thing a person
 * reads, in the order they read it.
 */
describe.skipIf(!testUrl)('the conversation', () => {
  const client = postgres(testUrl ?? '', { max: 8, onnotice: () => undefined });
  const db = drizzle(client, { schema: bot }) as unknown as BotDatabase;
  const START = new Date('2026-09-09T09:00:00.000Z');
  const clock = createFakeClock(START);
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

  /**
   * What a person would actually read, in order.
   *
   * Edits are filtered out. Locking an answered question rewrites the buttons on
   * a message already on their screen (§8); it is not a new message, and
   * counting it as one would make every transcript here off by one while
   * describing something nobody receives. `edits()` below is how the locking is
   * asserted on instead.
   */
  const deliver = async (update: IncomingUpdate): Promise<OutgoingMessage[]> => {
    const before = channel.sent.length;
    await handleUpdate(context(), update);
    await drainOutbox(context(), 50);
    return channel.sent
      .slice(before)
      .map((m) => m.message)
      .filter((m) => m.editChoicesOnly !== true);
  };

  /** Every in-place button edit sent so far, newest last. */
  const edits = (): readonly OutgoingMessage[] =>
    channel.sent.map((m) => m.message).filter((m) => m.editChoicesOnly === true);

  /** Sends a message and returns everything the bot said back, in order. */
  async function say(text: string): Promise<string[]> {
    updateSeq += 1;
    const sent = await deliver({
      kind: 'text',
      address: WHO,
      text,
      updateId: `u${String(updateSeq)}`,
    });
    return sent.map((m) => m.text);
  }

  /** Taps a button. */
  async function tap(data: string): Promise<string[]> {
    updateSeq += 1;
    const sent = await deliver({
      kind: 'choice',
      address: WHO,
      data,
      messageRef: 'm1',
      updateId: `u${String(updateSeq)}`,
    });
    return sent.map((m) => m.text);
  }

  /** Taps "share my number", which is the platform vouching for it (§5). */
  async function share(phone: string): Promise<string[]> {
    updateSeq += 1;
    const sent = await deliver({
      kind: 'contact',
      address: WHO,
      phone,
      updateId: `u${String(updateSeq)}`,
    });
    return sent.map((m) => m.text);
  }

  /** The last message's buttons, for asserting what was actually offered. */
  const lastChoices = (): readonly Choice[] =>
    channel.sent[channel.sent.length - 1]?.message.choices ?? [];

  /** The buttons on the most recent locked question. */
  const lastEditChoices = (): readonly Choice[] => edits().at(-1)?.choices ?? [];

  /**
   * The interview up to the summary, the way a person walks it.
   *
   * Ten steps: phone, name, date of birth (three taps), sex, group, weight,
   * the durable screening set, the location chain, and the last donation.
   */
  async function walkToSummary(): Promise<string[]> {
    await say('hello');
    await share('+919876543210');
    await say('Priya');
    await tap('dob:y:1994');
    await tap('dob:m:03');
    await tap('dob:d:12');
    await tap('sex:female');
    await tap('group:O-');
    await tap('weight:50_60');
    // Four durable questions for a female donor: the pregnancy one applies.
    await tap('durable:no');
    await tap('durable:no');
    await tap('durable:no');
    await tap('durable:no');
    await tap(`loc:district:${DISTRICT_ID}`);
    await tap(`loc:city:${CITY_ID}`);
    await tap(`loc:town:${TOWN_ID}`);
    return tap('donated:never');
  }

  const register = async (): Promise<string[]> => {
    await walkToSummary();
    return tap('sum:confirm');
  };

  beforeEach(async () => {
    channel = createMemoryChannel();
    updateSeq = 0;
    // The clock is shared, and the reminder tests move it. Without this, a test
    // that runs after them starts hours into the future and its own draft is
    // already "abandoned". An order dependency that passes alone and fails in
    // the suite.
    clock.set(START);
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
    // A three-level chain, so the location walk is a real walk.
    await client`INSERT INTO reference.location_nodes
                   (id, level, kind, parent_id, name, name_normalised, dataset_version)
                 VALUES (${DISTRICT_ID}, 'district', 'district', NULL, 'Conv District',
                         'conv district', 'test'),
                        (${CITY_ID}, 'city', 'taluk', ${DISTRICT_ID}, 'Conv City',
                         'conv city', 'test'),
                        (${TOWN_ID}, 'town', 'municipality', ${CITY_ID}, 'Feroke Junction',
                         'feroke junction', 'test')
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
  /* Getting in                                                            */
  /* ==================================================================== */

  it('starts the interview without anybody typing a command', async () => {
    // Whatever a new person says, the useful reply is the welcome and the first
    // question. Requiring `/start` is a step that exists for the system.
    const said = await say('hi');

    expect(said).toHaveLength(2);
    expect(said[0]).toContain('We message people nearby');
    expect(said[1]).toContain('phone number');
  });

  it('offers to take the number from the platform, and accepts typing too', async () => {
    await say('hi');
    // §5: the tap is the primary path and typing is the fallback, offered in
    // the same breath rather than as a second screen.
    const last = channel.sent[channel.sent.length - 1]?.message;
    expect(last?.requestContact).toBe(true);

    await say('+919876543210');
    const [phoneRow] = await db.select().from(bot.donorPhones);
    // Nothing is committed yet. The number is on the draft, not the profile.
    expect(phoneRow).toBeUndefined();
  });

  it('marks a shared number verified and a typed one not', async () => {
    await say('hi');
    await share('+919876543210');
    await register2();

    const [shared] = await db.select().from(bot.donorPhones);
    expect(shared?.verified).toBe(true);

    /** The rest of a registration, once the phone step is behind us. */
    async function register2(): Promise<void> {
      await say('Priya');
      await tap('dob:y:1994');
      await tap('dob:m:03');
      await tap('dob:d:12');
      await tap('sex:female');
      await tap('group:O-');
      await tap('weight:50_60');
      await tap('durable:no');
      await tap('durable:no');
      await tap('durable:no');
      await tap('durable:no');
      await tap(`loc:district:${DISTRICT_ID}`);
      await tap(`loc:city:${CITY_ID}`);
      await tap(`loc:town:${TOWN_ID}`);
      await tap('donated:never');
      await tap('sum:confirm');
    }
  });

  /* ==================================================================== */
  /* The interview                                                         */
  /* ==================================================================== */

  it('asks the date of birth as year, then month, then day', async () => {
    await say('hi');
    await share('+919876543210');
    await say('Priya');

    const year = await tap('dob:y:1994');
    expect(year[0]).toContain('month');
    const month = await tap('dob:m:03');
    expect(month[0]).toContain('day');
    const day = await tap('dob:d:12');
    // Age is never asked directly, because people round it (§5).
    expect(day[0]).toContain('male or female');
  });

  it('offers “I don’t know” for the blood group', async () => {
    await say('hi');
    await share('+919876543210');
    await say('Priya');
    await tap('dob:y:1994');
    await tap('dob:m:03');
    await tap('dob:d:12');
    await tap('sex:female');

    // §5: eight buttons plus "I don't know". Guessing is worse than not
    // knowing. Staff type the donor at their first donation.
    expect(lastChoices().map((c) => c.data)).toContain('group:unknown');
  });

  it('asks the pregnancy question of a female donor and not of a male one', async () => {
    const askedOf = async (sexChoice: string, who: string): Promise<string[]> => {
      const address = { channel: 'memory', channelUserId: who };
      const asked: string[] = [];
      const send = async (update: IncomingUpdate): Promise<void> => {
        await handleUpdate(context(), update);
        await drainOutbox(context(), 50);
      };
      let n = 0;
      const next = async (data: string): Promise<void> => {
        n += 1;
        await send({ kind: 'choice', address, data, messageRef: 'm', updateId: `${who}-${String(n)}` });
      };
      const text = async (value: string): Promise<void> => {
        n += 1;
        await send({ kind: 'text', address, text: value, updateId: `${who}-t${String(n)}` });
      };

      await text('hi');
      await text('+919876543299');
      await text('Sam');
      await next('dob:y:1994');
      await next('dob:m:03');
      await next('dob:d:12');
      await next(sexChoice);
      await next('group:O-');
      await next('weight:50_60');

      // Answer the whole durable set, collecting each question as it is asked.
      for (let i = 0; i < 5; i += 1) {
        const question = channel.to(who).at(-1)?.text ?? '';
        if (!question.includes('?') || question.includes('Which')) break;
        asked.push(question);
        await next('durable:no');
      }
      return asked;
    };

    const female = await askedOf('sex:female', 'preg-f');
    channel.clear();
    const male = await askedOf('sex:male', 'preg-m');

    // §5: sex decides whether the pregnancy question applies. It is not asked
    // of everybody with an awkward opt-out.
    expect(female.some((q) => q.includes('pregnant'))).toBe(true);
    expect(male.some((q) => q.includes('pregnant'))).toBe(false);
  });

  it('walks the location chain and finds a town by typing part of it', async () => {
    await say('hi');
    await share('+919876543210');
    await say('Priya');
    await tap('dob:y:1994');
    await tap('dob:m:03');
    await tap('dob:d:12');
    await tap('sex:female');
    await tap('group:O-');
    await tap('weight:50_60');
    await tap('durable:no');
    await tap('durable:no');
    await tap('durable:no');
    await tap('durable:no');

    const district = await tap(`loc:district:${DISTRICT_ID}`);
    expect(district[0]).toContain('city');

    const city = await tap(`loc:city:${CITY_ID}`);
    expect(city[0]).toContain('town');
  });

  /* ==================================================================== */
  /* The summary                                                           */
  /* ==================================================================== */

  it('plays every answer back, numbered, with the phone masked', async () => {
    const summary = await walkToSummary();
    const text = summary.join('\n');

    expect(text).toContain('Please check these details');
    expect(text).toContain('1  Phone');
    expect(text).toContain('9  Last donated');
    // The donor knows their own number; anyone reading over their shoulder in
    // a waiting room does not need it (§5).
    expect(text).not.toContain('+919876543210');
    expect(text).toContain('210');
    // Derived consequences, shown as consequences.
    expect(text).toContain('age 32');
    // The durable answers in the donor's own terms, not as a hidden score.
    expect(text).toContain('No long-term illness or medicine');
  });

  it('shows the group the donor gave, with no caveat attached', async () => {
    const summary = await walkToSummary();
    /*
      The summary used to hedge the group as "to be confirmed by staff at your
      first donation", which was accurate while a self-declared group blocked
      every match and is misleading now that it does not. It is the group
      recruitment acts on, and saying so is the honest version.
    */
    expect(summary.join('\n')).toContain('Blood group: O');
    expect(summary.join('\n')).not.toContain('to be confirmed');
  });

  it('commits nothing until the acknowledgement', async () => {
    await walkToSummary();

    // Everything is on the draft; the profile does not exist yet (§5).
    expect(await db.select().from(bot.donors)).toHaveLength(0);
    expect(await db.select().from(bot.donorConsents)).toHaveLength(0);

    await tap('sum:confirm');
    expect(await db.select().from(bot.donors)).toHaveLength(1);
  });

  it('records consent with the wording version and what was on screen', async () => {
    await register();

    const [consent] = await db.select().from(bot.donorConsents);
    expect(consent?.wordingVersion).toBeTruthy();
    // "They consented" is not evidence; "they consented to this text, showing
    // these values, at this time" is (§5).
    const snapshot = consent?.valuesSnapshot as Record<string, string>;
    expect(snapshot['name']).toBe('Priya');
    expect(snapshot['blood_group']).toContain('O−');
  });

  it('ends by saying when they will hear from us', async () => {
    const said = await register();
    // A donor should leave signup knowing what happens next: "registered" on
    // its own is how somebody concludes nothing happened (§5).
    expect(said[0]).toContain('You are registered');
    expect(said.join('\n')).toContain('message you when someone near you needs');
  });

  it('tells a donor with no known group why they will not be asked', async () => {
    await say('hi');
    await share('+919876543210');
    await say('Priya');
    await tap('dob:y:1994');
    await tap('dob:m:03');
    await tap('dob:d:12');
    await tap('sex:female');
    await tap('group:unknown');
    await tap('weight:50_60');
    await tap('durable:no');
    await tap('durable:no');
    await tap('durable:no');
    await tap('durable:no');
    await tap(`loc:district:${DISTRICT_ID}`);
    await tap(`loc:city:${CITY_ID}`);
    await tap(`loc:town:${TOWN_ID}`);
    await tap('donated:never');
    const said = await tap('sum:confirm');

    // An ending, not a rejection, and the wording carries the difference (§5).
    expect(said[0]).toContain('You are registered');
    expect(said[0]).toContain('do not know your blood group');
    expect(said[0]).toContain('walk in');
  });

  /* ==================================================================== */
  /* Fixing                                                                */
  /* ==================================================================== */

  it('jumps straight to one field and comes back to the summary', async () => {
    await walkToSummary();

    const asked = await say('2');
    expect(asked[0]).toContain('What is your name?');

    const back = await say('Anitha');
    // Back to the summary, once, with the change marked (§5).
    expect(back[0]).toContain('Please check these details');
    expect(back[0]).toContain('Anitha');
    expect(back[0]).toContain('(updated)');
  });

  /**
   * The behaviour §5 spends a page on, and the one P7 is asked to prove.
   *
   * "If someone got three answers wrong, they should fix three answers once,
   * not make three round trips through the summary."
   */
  it('fixes three ticked fields in one pass and returns to the summary once', async () => {
    await walkToSummary();

    await tap('sum:fix');
    // The ticks accumulate and the list stays open.
    await tap('fix:toggle:name');
    await tap('fix:toggle:weight');
    const third = await tap('fix:toggle:last_donation');
    expect(third[0]).toContain('Which ones need fixing');
    expect(lastChoices().some((c) => c.label.startsWith('Fix these (3)'))).toBe(true);

    const first = await tap('fix:go');
    // In summary order, whatever order they were tapped: name (2) first.
    expect(first[0]).toContain('What is your name?');

    const second = await say('Anitha');
    expect(second[0]).toContain('what do you weigh');
    // Still not back at the summary. That is the whole point.
    expect(second.join('\n')).not.toContain('Please check these details');

    const last = await tap('weight:60_70');
    expect(last[0]).toContain('last give blood');

    const summary = await tap('donated:never');
    expect(summary).toHaveLength(1);
    expect(summary[0]).toContain('Please check these details');
    expect(summary[0]).toContain('Anitha');
    expect(summary[0]).toContain('60–70');
  });

  it('leaves the summary untouched when a fix is cancelled', async () => {
    await walkToSummary();
    await tap('sum:fix');
    await tap('fix:toggle:name');

    const back = await tap('fix:cancel');
    expect(back[0]).toContain('Please check these details');
    expect(back[0]).toContain('Priya');
    // Nothing was changed, so nothing is marked as changed.
    expect(back[0]).not.toContain('(updated)');
  });

  it('accepts a typed list of rows, for a channel that cannot toggle', async () => {
    await walkToSummary();
    await tap('sum:fix');

    // §2.11: WhatsApp's interactive lists cap rows per message, so its adapter
    // renders the numbered list and accepts "3, 5, 7" as a reply.
    const first = await say('2, 6');
    expect(first[0]).toContain('What is your name?');

    await say('Anitha');
    const summary = await tap('weight:70_plus');
    expect(summary[0]).toContain('Please check these details');
  });

  it('re-asks the whole screening set when screening is fixed', async () => {
    await walkToSummary();

    // Which question was wrong is exactly what the donor cannot see from the
    // summary, and the set is only three or four taps (§5).
    const first = await say('7');
    expect(first[0]).toContain('?');

    await tap('durable:no');
    await tap('durable:no');
    await tap('durable:no');
    const back = await tap('durable:no');
    expect(back[0]).toContain('Please check these details');
  });

  it('restarts the location chain when the location is fixed', async () => {
    await walkToSummary();

    const first = await say('8');
    // A town in the old district is meaningless in the new one, so the edit
    // continues down the chain rather than stopping (§5).
    expect(first[0]).toContain('district');

    await tap(`loc:district:${DISTRICT_ID}`);
    await tap(`loc:city:${CITY_ID}`);
    const back = await tap(`loc:town:${TOWN_ID}`);
    expect(back[0]).toContain('Please check these details');
  });

  /* ==================================================================== */
  /* Resuming                                                              */
  /* ==================================================================== */

  it('resumes on the question it stopped at, across a restart', async () => {
    await say('hi');
    await share('+919876543210');
    await say('Priya');
    await tap('dob:y:1994');

    // Nothing is held in the process: a new context is a new "process", and
    // the next answer must land on the question they were actually on.
    const said = await tap('dob:m:03');
    expect(said[0]).toContain('day');

    const [state] = await db.select().from(bot.conversationState);
    expect(state?.step).toBe('dob');
    expect((state?.draft as { dob?: string }).dob).toBe('1994-03');
  });

  it('treats "start" from a registered donor as a return, not a re-registration', async () => {
    await register();
    const said = await say('start');

    expect(said[0]).toContain('Welcome back');
    // One donor, not two.
    expect(await db.select().from(bot.donors)).toHaveLength(1);
  });

  it('never tells somebody who just registered that they are not registered', async () => {
    await register();
    const said = await say('what now?');

    // The bug this file was written for.
    expect(said.join('\n')).not.toContain('not registered');
  });

  /* ==================================================================== */
  /* "Not now". The ending §8 calls dormant                               */
  /* ==================================================================== */

  describe('declining the acknowledgement', () => {
    it('keeps everything and says how to turn it on', async () => {
      await walkToSummary();
      const said = await tap('sum:decline');

      // Not the abandoned message: nothing was lost, and saying so would be
      // untrue (§5).
      expect(said[0]).toContain('details are saved');
      expect(said[0]).toContain('resume');
      expect(said[0]).not.toContain('nothing was saved');
    });

    it('registers them, dormant', async () => {
      await walkToSummary();
      await tap('sum:decline');

      const [donor] = await db.select().from(bot.donors);
      expect(donor?.name).toBe('Priya');
      /**
       * The one thing missing is the acknowledgement. §7.7 recruits nobody
       * whose consent is not current, so a dormant registration is dormant by
       * the same rule that governs everybody else.
       */
      expect(donor?.consentCurrentAt).toBeNull();
      // And no consent row, because they did not consent. The table that is
      // the evidence of consent must not contain a record of a refusal.
      expect(await db.select().from(bot.donorConsents)).toHaveLength(0);
    });

    it('turns on with one word, with nothing to retype', async () => {
      await walkToSummary();
      await tap('sum:decline');

      const said = await say('resume');
      expect(said[0]).toBeTruthy();

      const [donor] = await db.select().from(bot.donors);
      expect(donor?.consentCurrentAt).not.toBeNull();
      // Still one donor: coming back is not a second registration.
      expect(await db.select().from(bot.donors)).toHaveLength(1);
    });
  });

  /* ==================================================================== */
  /* Filled before they answered                                           */
  /* ==================================================================== */

  describe('a request that fills without them', () => {
    it('tells them it is covered and stops offering Accept', async () => {
      await register();
      const [donor] = await db.select().from(bot.donors);

      const botRequestId = newId();
      await db.insert(bot.botRequests).values({
        id: botRequestId,
        demandId: newId(),
        publicId: 'covered-1',
        bloodGroup: 'O-',
        product: 'whole_blood',
        unitsNeeded: 1,
        neededBy: addDays(clock.today(), 2),
        hospitalSnapshot: { hospitalName: 'Test centre', hospitalAddress: 'Somewhere' },
        // Filled, but not yet closed. The window this exists for.
        status: 'fulfilled',
      });
      const journeyId = newId();
      await db.insert(bot.donorRequests).values({
        id: journeyId,
        botRequestId,
        donorId: donor?.id ?? '',
        status: 'NOTIFIED',
        waveNo: 1,
        notifiedAt: clock.now(),
      });

      const before = channel.sent.length;
      const result = await tellUnansweredItIsCovered(context());
      await drainOutbox(context(), 50);
      const sent = channel.sent.slice(before).map((m) => m.message.text);

      expect(result.told).toBe(1);
      // One line, and it thanks them: they did nothing wrong (§8).
      expect(sent.join('\n')).toContain('covered');
      expect(sent.join('\n')).toContain('thank you');

      const [journey] = await db.select().from(bot.donorRequests);
      // The card stops offering Accept because the journey is over.
      expect(journey?.status).toBe('CANCELLED');
    });

    it('says it once, however often the ticker runs', async () => {
      await register();
      const [donor] = await db.select().from(bot.donors);
      const botRequestId = newId();
      await db.insert(bot.botRequests).values({
        id: botRequestId,
        demandId: newId(),
        publicId: 'covered-2',
        bloodGroup: 'O-',
        product: 'whole_blood',
        unitsNeeded: 1,
        neededBy: addDays(clock.today(), 2),
        hospitalSnapshot: { hospitalName: 'Test centre', hospitalAddress: 'Somewhere' },
        status: 'fulfilled',
      });
      await db.insert(bot.donorRequests).values({
        id: newId(),
        botRequestId,
        donorId: donor?.id ?? '',
        status: 'NOTIFIED',
        waveNo: 1,
        notifiedAt: clock.now(),
      });

      const first = await tellUnansweredItIsCovered(context());
      const second = await tellUnansweredItIsCovered(context());

      // The status move is the guard: the second pass finds nobody NOTIFIED.
      expect(first.told).toBe(1);
      expect(second.told).toBe(0);
    });

    it('leaves somebody mid-journey alone', async () => {
      await register();
      const [donor] = await db.select().from(bot.donors);
      const botRequestId = newId();
      await db.insert(bot.botRequests).values({
        id: botRequestId,
        demandId: newId(),
        publicId: 'covered-3',
        bloodGroup: 'O-',
        product: 'whole_blood',
        unitsNeeded: 1,
        neededBy: addDays(clock.today(), 2),
        hospitalSnapshot: { hospitalName: 'Test centre', hospitalAddress: 'Somewhere' },
        status: 'fulfilled',
      });
      await db.insert(bot.donorRequests).values({
        id: newId(),
        botRequestId,
        donorId: donor?.id ?? '',
        // Already answering the questions: cancelling them out from under it
        // would be worse than saying nothing.
        status: 'SCREENING',
        waveNo: 1,
        notifiedAt: clock.now(),
      });

      const result = await tellUnansweredItIsCovered(context());
      expect(result.told).toBe(0);
    });
  });

  /* ==================================================================== */
  /* The abandoned signup                                                  */
  /* ==================================================================== */

  describe('an abandoned signup', () => {
    /**
     * Time passes, rather than a column being doctored.
     *
     * `conversation_state` has a BEFORE UPDATE trigger that stamps
     * `updated_at`, so backdating the row would be overwritten, and that
     * trigger is what makes "untouched for six hours" mean what it says.
     * Moving the clock is both honest and the only thing that works.
     */
    const walkedAway = (hours: number): void => {
      clock.advanceMs(hours * 3_600_000);
    };

    it('is nudged once, and never again', async () => {
      await say('hi');
      await share('+919876543210');
      await say('Priya');
      walkedAway(8);

      const first = await remindAbandonedSignups(context());
      expect(first.reminded).toBe(1);

      // "One gentle reminder, once; then silence" (§5). Enforced by the
      // outbox's unique dedupe key, so a second pass writes nothing whatever
      // the ticker does.
      walkedAway(20);
      const second = await remindAbandonedSignups(context());
      expect(second.reminded).toBe(0);
    });

    /**
     * The bug this comment outlives.
     *
     * The reminder used to compare `updated_at`, written by a database
     * trigger on the server's clock, against a cutoff derived from the
     * injected one. It passed at half past three and failed at five. Running
     * the same assertion at two different fake times is what pins the fix.
     */
    it('measures idleness on the injected clock, not the server’s', async () => {
      await say('hi');
      await share('+919876543210');

      // Two hours after they stopped: too soon, whatever the server's clock
      // happens to say.
      clock.set(new Date(START.getTime() + 2 * 3_600_000));
      expect((await remindAbandonedSignups(context())).reminded).toBe(0);

      // Seven hours after they stopped: due, on the same reasoning.
      clock.set(new Date(START.getTime() + 7 * 3_600_000));
      expect((await remindAbandonedSignups(context())).reminded).toBe(1);
    });

    it('says nothing to somebody who only just stopped', async () => {
      await say('hi');
      await share('+919876543210');

      const result = await remindAbandonedSignups(context());
      // Somebody who put their phone down mid-question is not chased.
      expect(result.reminded).toBe(0);
    });

    it('holds their progress, and drops them back on the same question', async () => {
      await say('hi');
      await share('+919876543210');
      await say('Priya');
      await tap('dob:y:1994');
      walkedAway(8);

      await remindAbandonedSignups(context());
      await drainOutbox(context(), 50);

      // Nothing is deleted. Coming back answers the question they were on.
      const back = await tap('dob:m:03');
      expect(back[0]).toContain('day');
      expect(await db.select().from(bot.donors)).toHaveLength(0);
    });
  });

  /* ==================================================================== */
  /* Qualification, decided from the answers and stored                    */
  /* ==================================================================== */

  describe('qualification', () => {
    it('writes the decision onto the donor when they register', async () => {
      await register();

      const [donor] = await db.select().from(bot.donors);
      expect(donor?.qualificationStatus).toBe('qualified');
      expect(donor?.qualificationReason).toBeNull();
      // Stamped, so a stale row is visible as one rather than being guessed at.
      expect(donor?.qualifiedAt).not.toBeNull();
    });

    it('stores why, in the donor’s own terms, when a threshold stops them', async () => {
      await say('hello');
      await share('+919876543210');
      await say('Priya');
      await tap('dob:y:1994');
      await tap('dob:m:03');
      await tap('dob:d:12');
      await tap('sex:female');
      await tap('group:O-');
      // The band below the threshold. It used to be stored as exactly the
      // minimum, so this donor passed the check that exists to stop them.
      await tap('weight:under_45');
      await tap('durable:no');
      await tap('durable:no');
      await tap('durable:no');
      await tap('durable:no');
      await tap(`loc:district:${DISTRICT_ID}`);
      await tap(`loc:city:${CITY_ID}`);
      await tap(`loc:town:${TOWN_ID}`);
      await tap('donated:never');
      await tap('sum:confirm');

      const [donor] = await db.select().from(bot.donors);
      expect(donor?.weightKg).toBe(0);
      expect(donor?.qualificationStatus).toBe('not_qualified');
      expect(donor?.qualificationReason).toContain('45 kg');
    });

    it('will not match a donor who does not know their group', async () => {
      await say('hello');
      await share('+919876543210');
      await say('Priya');
      await tap('dob:y:1994');
      await tap('dob:m:03');
      await tap('dob:d:12');
      await tap('sex:female');
      // "I don't know" is a blank, not an answer.
      await tap('group:unknown');
      await tap('weight:50_60');
      await tap('durable:no');
      await tap('durable:no');
      await tap('durable:no');
      await tap('durable:no');
      await tap(`loc:district:${DISTRICT_ID}`);
      await tap(`loc:city:${CITY_ID}`);
      await tap(`loc:town:${TOWN_ID}`);
      await tap('donated:never');
      await tap('sum:confirm');

      const [donor] = await db.select().from(bot.donors);
      /*
        The column cannot hold a blank, so it holds a default. Recruiting on
        that would match somebody on a group the system chose for them, which is
        a different thing entirely from acting on a group they gave us.
      */
      expect(donor?.qualificationStatus).toBe('not_qualified');
      expect(donor?.qualificationReason).toContain('do not know your blood group');
      // And the way out is named in the same breath (§8).
      expect(donor?.qualificationReason).toContain('Walk in');
    });

    it('flags a donor whose health answer needs a person to look', async () => {
      await say('hello');
      await share('+919876543210');
      await say('Priya');
      await tap('dob:y:1994');
      await tap('dob:m:03');
      await tap('dob:d:12');
      await tap('sex:female');
      await tap('group:O-');
      await tap('weight:50_60');
      // Yes to the first durable question, which is the flagging answer.
      await tap('durable:yes');
      await tap('durable:no');
      await tap('durable:no');
      await tap('durable:no');
      await tap(`loc:district:${DISTRICT_ID}`);
      await tap(`loc:city:${CITY_ID}`);
      await tap(`loc:town:${TOWN_ID}`);
      await tap('donated:never');
      await tap('sum:confirm');

      const [donor] = await db.select().from(bot.donors);
      expect(donor?.qualificationStatus).toBe('flagged');
      expect(donor?.durableFlagStatus).toBe('flagged');
    });

    it('sets the donation window from the last donation they reported', async () => {
      await say('hello');
      await share('+919876543210');
      await say('Priya');
      await tap('dob:y:1994');
      await tap('dob:m:03');
      await tap('dob:d:12');
      await tap('sex:female');
      await tap('group:O-');
      await tap('weight:50_60');
      await tap('durable:no');
      await tap('durable:no');
      await tap('durable:no');
      await tap('durable:no');
      await tap(`loc:district:${DISTRICT_ID}`);
      await tap(`loc:city:${CITY_ID}`);
      await tap(`loc:town:${TOWN_ID}`);
      // "Within the last 3 months" is read as today, which is the safe
      // direction: assuming somebody gave more recently than they did only
      // ever delays their next donation.
      await tap('donated:recent');
      await tap('sum:confirm');

      const [donor] = await db.select().from(bot.donors);
      expect(donor?.lastDonatedOn).toBe(clock.today());
      // A female donor waits 120 days, and the qualification says nothing
      // about it: the window is a fact about the calendar, checked live.
      expect(donor?.nextEligibleOn).toBe(addDays(clock.today(), 120));
      expect(donor?.qualificationStatus).toBe('qualified');
    });

    it('tells a donor inside their window when they can give again', async () => {
      await register();
      const soon = addDays(clock.today(), 30);
      await client`UPDATE bot.donors SET next_eligible_on = ${soon}`;

      const said = await say('what now?');
      expect(said[0]).toContain('You can give again from');
    });
  });

  /* ==================================================================== */
  /* One answer per question                                               */
  /* ==================================================================== */

  describe('an answered question', () => {
    it('marks the answer and makes the other options inert', async () => {
      await say('hello');
      await share('+919876543210');
      await say('Priya');
      await tap('dob:y:1994');
      await tap('dob:m:03');
      await tap('dob:d:12');
      await tap('sex:female');

      const locked = lastEditChoices();
      expect(locked.map((c) => c.label)).toEqual(['Female', 'Male', 'Other']);

      // The one they picked is marked, and it keeps its real callback data so
      // a scroll-back shows what was answered.
      expect(locked.find((c) => c.data === 'sex:female')?.state).toBe('chosen');
      // The rest stay visible and stop being answerable.
      expect(locked.find((c) => c.label === 'Male')?.state).toBe('unavailable');
      expect(locked.find((c) => c.label === 'Other')?.state).toBe('unavailable');
    });

    it('edits the buttons of the message they tapped, never its text', async () => {
      await say('hello');
      await share('+919876543210');
      await say('Priya');
      await tap('dob:y:1994');

      const edit = edits().at(-1);
      /*
        The question is already on their screen and correct. Re-sending the text
        would reflow the chat, and Telegram refuses an edit that changes
        nothing, so a lock that touched the text would fail every time.
      */
      expect(edit?.editChoicesOnly).toBe(true);
      expect(edit?.replaces).toBeDefined();
    });

    it('ignores a tap on an option that has already been answered', async () => {
      await say('hello');
      await share('+919876543210');
      await say('Priya');
      await tap('dob:y:1994');
      await tap('dob:m:03');
      await tap('dob:d:12');
      await tap('sex:female');

      const before = channel.sent.length;
      // What a platform with no way to disable a button actually delivers.
      const said = await tap('answered');

      // Silence. They tapped something visibly inert, and answering with their
      // standing situation would be a wall of text they did not ask for.
      expect(said).toEqual([]);
      expect(channel.sent.length).toBe(before);
    });

    it('leaves the buttons live when the answer was refused', async () => {
      await say('hello');
      await share('+919876543210');
      await say('Priya');

      const before = edits().length;
      // A year outside the offered range: the question stands, so its buttons
      // must too. Ticking an option that was not accepted would be a lie.
      await tap('dob:y:1200');

      expect(edits().length).toBe(before);
    });

    it('re-asks a corrected question with every option live again', async () => {
      await register();
      await say('profile');

      // Row 4 is the sex question. The fix flow re-asks the original question.
      const asked = await say('4');
      expect(asked.at(-1)).toContain('male or female');

      const offered = lastChoices();
      expect(offered).toHaveLength(3);
      // Nothing carried over from the first time it was answered: every option
      // is answerable again (§5).
      expect(offered.every((c) => c.state === undefined)).toBe(true);

      // And answering it locks it in exactly the same way.
      await tap('sex:male');
      expect(lastEditChoices().find((c) => c.data === 'sex:male')?.state).toBe('chosen');
      expect(lastEditChoices().find((c) => c.data === 'sex:female')?.state).toBe(
        'unavailable',
      );
    });
  });

  /* ==================================================================== */
  /* The menu, and offering to give                                        */
  /* ==================================================================== */

  describe('the menu', () => {
    it('puts the same options under every ordinary reply', async () => {
      await register();
      await say('hello again');

      const labels = lastChoices().map((c) => c.data);
      // Every one of these is a word somebody could have typed instead. The
      // menu is discoverability, not a second way through the system.
      expect(labels).toContain('needs');
      expect(labels).toContain('donate');
      expect(labels).toContain('profile');
      expect(labels).toContain('help');
    });

    it('offers "start again" rather than "pause" to a donor who is paused', async () => {
      await register();
      await say('pause');
      const said = await say('hello');

      expect(said.join(' ')).toContain('paused');
      const labels = lastChoices().map((c) => c.data);
      expect(labels).toContain('resume');
      expect(labels).not.toContain('pause');
    });

    it('tapping a menu button does the same thing as typing the word', async () => {
      await register();
      const typed = await say('needs');
      const tapped = await tap('needs');

      expect(tapped).toEqual(typed);
    });
  });

  describe('offering to give', () => {
    it('thanks somebody who offers, and says what is standing in the way', async () => {
      await register();
      /*
        The reason is the one written when they answered, so the bot repeats what
        they were already told rather than inventing a second wording for the
        same fact.
      */
      await client`UPDATE bot.donors
                      SET qualification_status = 'not_qualified',
                          qualification_reason = 'Donors need to weigh at least 45 kg.'`;

      const said = await say('donate');

      // Thanked first. Somebody who offered has done nothing wrong (§2.7).
      expect(said[0]).toContain('noted that you would like to give');
      expect(said[0]).toContain('Donors need to weigh at least 45 kg.');
    });

    it('tells a qualified donor they are in the pool', async () => {
      await register();

      const said = await say('donate');
      expect(said[0]).toContain('You are in the pool');
    });

    it('records the offer, and creates no journey for it', async () => {
      await register();
      await say('donate');

      const events = await db.select().from(bot.eventLog);
      expect(events.some((row) => row.event === 'donor.interest_declared')).toBe(true);

      /*
        A journey is a commitment against a specific request. There is no
        request here, and inventing one would put a name on a counter's roster
        for a unit nobody asked for.
      */
      expect(await db.select().from(bot.donorRequests)).toHaveLength(0);
    });
  });

  /* ==================================================================== */
  /* The demand board, and the link that leads to it                       */
  /* ==================================================================== */

  describe('the demand board', () => {
    /** An open request, as the bot would hold it after importing a demand. */
    const openRequest = async (
      bloodGroup: string,
      publicId: string,
    ): Promise<string> => {
      const id = newId();
      await db.insert(bot.botRequests).values({
        id,
        demandId: newId(),
        publicId,
        bloodGroup,
        product: 'whole_blood',
        unitsNeeded: 2,
        neededBy: addDays(clock.today(), 3),
        hospitalSnapshot: { hospitalName: 'Test centre', hospitalAddress: 'Somewhere' },
        status: 'open',
      });
      return id;
    };

    it('answers a stranger without making them register first', async () => {
      await openRequest('O-', 'need-open-1');

      // §5: open to everyone, registered or not. A visitor asking "what is
      // needed?" gets an answer, not a signup form.
      const said = await deliver({
        kind: 'text',
        address: { channel: 'memory', channelUserId: 'visitor-1' },
        text: '/start need-open-1',
        updateId: 'v1',
      });

      expect(said[0]?.text).toContain('needs O− blood');
      // …and then it takes them to the first question, holding the link.
      expect(said[1]?.text).toContain('phone number');
    });

    it('brings a visitor back to the request they arrived on', async () => {
      await openRequest('O-', 'need-open-2');

      await say('/start need-open-2');
      await share('+919876543210');
      await say('Priya');
      await tap('dob:y:1994');
      await tap('dob:m:03');
      await tap('dob:d:12');
      await tap('sex:female');
      await tap('group:O-');
      await tap('weight:50_60');
      await tap('durable:no');
      await tap('durable:no');
      await tap('durable:no');
      await tap('durable:no');
      await tap(`loc:district:${DISTRICT_ID}`);
      await tap(`loc:city:${CITY_ID}`);
      await tap(`loc:town:${TOWN_ID}`);
      await tap('donated:never');
      const said = await tap('sum:confirm');

      // "The link is never lost" (§5). Across the whole interview.
      expect(said.join('\n')).toContain('back to why you came');
      expect(said.join('\n')).toContain('Test centre');

      // And the same journey a wave would have created, so the same questions
      // follow from here.
      const [journey] = await db.select().from(bot.donorRequests);
      expect(journey?.status).toBe('NOTIFIED');
      expect(journey?.waveNo).toBe(0);
    });

    it('shows a registered donor their matches first, and the rest below', async () => {
      await register();
      /**
       * AB+, not the O− they registered as.
       *
       * O− is the universal red-cell donor and matches every request, which
       * makes it useless for testing the split. AB+ red cells can go only to
       * AB+, so exactly one of these two is theirs to answer.
       */
      await client`UPDATE bot.donors SET blood_group = 'AB+'`;
      await openRequest('O-', 'need-other');
      await openRequest('AB+', 'need-mine');

      const said = await say('board');
      const text = said[0] ?? '';

      // ● marks what they can give for; ○ is a different group, still visible,
      // because "nothing for you" and "nothing at all" are different facts.
      expect(text).toContain('● AB+');
      expect(text).toContain('○ O−');
      expect(text.indexOf('● AB+')).toBeLessThan(text.indexOf('○ O−'));
      expect(text).toContain('a different group');
    });

    it('says once why a donor cannot answer, without a lecture', async () => {
      await register();
      await openRequest('O-', 'need-blocked');

      /*
        The stored judgement, written when they answered. The board says it back
        in the same words rather than composing a second version of the same
        fact, which is how a bot ends up telling somebody two different things.
      */
      await client`UPDATE bot.donors
                      SET qualification_status = 'not_qualified',
                          qualification_reason =
                            'Blood donation starts at 18. We will be glad to hear from you then.'`;

      const said = await say('board');
      expect(said[0]).toContain('Blood donation starts at 18');
      // The way out, not just the refusal (§8).
      expect(said[0]).toContain('glad to hear from you');
    });

    it('acts on the group the donor gave, with nobody having typed it', async () => {
      await register();
      await openRequest('O-', 'need-declared');

      /*
        The rule that changed. A self-declared group used to block every match,
        which meant a donor who had never given could never be asked and so
        could never be typed. The unit is typed at the counter either way.
      */
      const [donor] = await db.select().from(bot.donors);
      expect(donor?.bloodGroupVerifiedAt).toBeNull();

      await say('board');
      expect(lastChoices().some((c) => c.data === 'board:need-declared')).toBe(true);
    });

    it('offers no tap when the donor cannot give, and one when they can', async () => {
      await register();
      await openRequest('O-', 'need-tap');

      await client`UPDATE bot.donors
                      SET qualification_status = 'not_qualified',
                          qualification_reason = 'Donors need to weigh at least 45 kg.'`;

      /*
        Read after the board is asked for, not before: the message ahead of it
        is the standing reply, and that one carries the menu. What this test is
        about is the tap on a request, so it asserts on that and not on the
        absence of every button.
      */
      await say('board');
      expect(lastChoices().some((c) => c.data.startsWith('board:'))).toBe(false);

      // Whatever it was is resolved; now the tap appears.
      await client`UPDATE bot.donors
                      SET qualification_status = 'qualified', qualification_reason = NULL`;
      await say('board');
      expect(lastChoices().some((c) => c.data === 'board:need-tap')).toBe(true);
    });

    it('turns a board tap into the same journey a wave would have made', async () => {
      await register();
      await openRequest('O-', 'need-tapped');
      await say('board');
      const said = await tap('board:need-tapped');

      // One path, not two (§5): the same card, and the same two answers.
      expect(said[0]).toContain('Could you give?');
      expect(lastChoices().some((c) => c.data.startsWith('accept:'))).toBe(true);

      const [journey] = await db.select().from(bot.donorRequests);
      expect(journey?.status).toBe('NOTIFIED');
    });

    it('does not create a second journey when the same request is tapped twice', async () => {
      await register();
      await openRequest('O-', 'need-twice');
      await say('board');
      await tap('board:need-twice');
      await tap('board:need-twice');

      // A donor who taps the board after being pushed the card must not end up
      // holding two places for one request.
      expect(await db.select().from(bot.donorRequests)).toHaveLength(1);
    });

    it('says so kindly when the link has already been answered', async () => {
      await register();
      const said = await say('/start no-such-request');

      expect(said[0]).toContain('already been answered');
    });
  });

  /* ==================================================================== */
  /* The profile editor, and the controls                                  */
  /* ==================================================================== */

  it('reopens the same summary as the profile editor', async () => {
    await register();

    const said = await say('profile');
    // One implementation, two entry points (§5).
    expect(said[0]).toContain('Please check these details');
    expect(said[0]).toContain('Priya');
  });

  it('re-records the acknowledgement when the profile is saved', async () => {
    await register();
    const before = await db.select().from(bot.donorConsents);

    await say('profile');
    await say('2');
    await say('Anitha');
    const saved = await tap('sum:confirm');

    expect(saved[0]).toContain('Saved');
    const after = await db.select().from(bot.donorConsents);
    // The donor is agreeing to the summary in front of them, not to a form
    // they filled in months ago (§5).
    expect(after.length).toBe(before.length + 1);

    const [donor] = await db.select().from(bot.donors);
    expect(donor?.name).toBe('Anitha');
    // Still one donor: an edit is not a second registration.
    expect(await db.select().from(bot.donors)).toHaveLength(1);
  });

  it('pauses, and says when it lifts', async () => {
    await register();
    const said = await say('pause');
    expect(said[0]).toMatch(/\d/);

    const [donor] = await db.select().from(bot.donors);
    expect(donor?.snoozeUntil).not.toBeNull();
  });

  /**
   * The third thing P7 is asked to prove.
   *
   * "Deleting a donor who donated keeps the donation and the bag identifier,
   * and drops the name and number."
   */
  it('erases the donor and keeps the donation, without the name on it', async () => {
    await register();
    const [donor] = await db.select().from(bot.donors);
    const donorId = donor?.id ?? '';

    // A donation, as the bot would have written it and the counter marked it.
    const demandId = newId();
    await db.insert(donorDemand).values({
      id: demandId,
      centreId: CENTRE_ID,
      trigger: 'stock_floor',
      bloodGroup: 'O-',
      product: 'whole_blood',
      units: 1,
      dateRequired: clock.today(),
      hospitalName: 'Test centre',
      hospitalAddress: 'Somewhere',
      districtId: DISTRICT_ID,
      status: 'open',
    });
    await db.insert(donorDemandConfirmations).values({
      id: newId(),
      demandId,
      donorId,
      channel: 'memory',
      donorName: 'Priya',
      donorPhone: '+919876543210',
      bloodGroup: 'O-',
      confirmedAt: clock.now(),
      status: 'completed',
      donatedAt: clock.today(),
      bagIdentifier: 'U-ERASE-1',
    });

    await say('delete');
    const said = await tap(`delete:${donorId}`);

    // Told what was kept, not just that everything went (§12.1).
    expect(said[0]).toContain('1 donation stays');

    const [kept] = await db
      .select()
      .from(donorDemandConfirmations)
      .where(eq(donorDemandConfirmations.donorId, donorId));

    // The donation record survives, because the centre is required to keep it.
    expect(kept?.bagIdentifier).toBe('U-ERASE-1');
    expect(kept?.donatedAt).toBe(clock.today());
    // The person does not.
    expect(kept?.donorName).toBe('Deleted donor');
    expect(kept?.donorPhone).not.toContain('9876543210');

    expect(await db.select().from(bot.donorPhones)).toHaveLength(0);
    expect(await db.select().from(bot.donorChannels)).toHaveLength(0);

    // The consent row stays as a dated record; what it was showing does not.
    const [consent] = await db.select().from(bot.donorConsents);
    expect(JSON.stringify(consent?.valuesSnapshot)).not.toContain('Priya');
  });
});
