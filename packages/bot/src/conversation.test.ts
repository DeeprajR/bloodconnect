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
import type { IncomingUpdate, OutgoingMessage } from './ports/channel.js';

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
 * So these tests assert the *transcript*, not the internals — the thing a person
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

  const deliver = async (update: IncomingUpdate): Promise<OutgoingMessage[]> => {
    const before = channel.sent.length;
    await handleUpdate(context(), update);
    await drainOutbox(context(), 50);
    return channel.sent.slice(before).map((m) => m.message);
  };

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
  const lastChoices = (): readonly { label: string; data: string }[] =>
    channel.sent[channel.sent.length - 1]?.message.choices ?? [];

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
    // already "abandoned" — an order dependency that passes alone and fails in
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
    expect(said[0]).toContain('Blood Connect asks people nearby');
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
    // Nothing is committed yet — the number is on the draft, not the profile.
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
    // knowing — staff type the donor at their first donation.
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

    // §5: sex decides whether the pregnancy question applies — it is not asked
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
    expect(text).toContain('No long-term illness or medication');
  });

  it('says the group is unconfirmed until staff type it', async () => {
    const summary = await walkToSummary();
    expect(summary.join('\n')).toContain('to be confirmed by staff');
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
    // A donor should leave signup knowing what happens next — "registered" on
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
    expect(asked[0]).toContain('What should we call you?');

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
    expect(first[0]).toContain('What should we call you?');

    const second = await say('Anitha');
    expect(second[0]).toContain('what do you weigh');
    // Still not back at the summary — that is the whole point.
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
    expect(first[0]).toContain('What should we call you?');

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
  /* The abandoned signup                                                  */
  /* ==================================================================== */

  describe('an abandoned signup', () => {
    /**
     * Time passes, rather than a column being doctored.
     *
     * `conversation_state` has a BEFORE UPDATE trigger that stamps
     * `updated_at`, so backdating the row would be overwritten — and that
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
     * The reminder used to compare `updated_at` — written by a database
     * trigger on the server's clock — against a cutoff derived from the
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

      // "The link is never lost" (§5) — across the whole interview.
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
       * makes it useless for testing the split — AB+ red cells can go only to
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

      // A donor whose group has never been typed by staff is not matchable —
      // §7.7 recruits nobody on a self-declared group.
      const said = await say('board');
      expect(said[0]).toContain('not been confirmed');
      expect(said[0]).toContain('walk in');
    });

    it('offers no tap when the donor cannot give, and one when they can', async () => {
      await register();
      await openRequest('O-', 'need-tap');

      const blocked = channel.sent.at(-1)?.message.choices ?? [];
      await say('board');
      expect(blocked).toEqual([]);

      // Staff type them at their first donation; now the tap appears.
      await client`UPDATE bot.donors SET blood_group_verified_at = now()`;
      await say('board');
      expect(lastChoices().some((c) => c.data === 'board:need-tap')).toBe(true);
    });

    it('turns a board tap into the same journey a wave would have made', async () => {
      await register();
      await openRequest('O-', 'need-tapped');
      await client`UPDATE bot.donors SET blood_group_verified_at = now()`;

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
      await client`UPDATE bot.donors SET blood_group_verified_at = now()`;

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
