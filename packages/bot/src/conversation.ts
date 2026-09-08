/**
 * Turning an incoming update into one use-case call (§3, §9.5).
 *
 * The equivalent of a route handler: it parses, dispatches, and formats a reply.
 * No rule lives here — whether a donor may give, whether a place is still open,
 * whether a tap is a replay, are all decided inside a use case, on a
 * transaction. This file only decides what the person sees.
 *
 * **Routing is by the person's state, not by a command.** Somebody who has never
 * registered gets the first question, whatever they typed; somebody part-way
 * through gets the next one; somebody registered gets an answer about their own
 * situation. Nobody has to know that `/start` exists.
 *
 * That ordering — *who is this?* before *what did they say?* — is also the fix
 * for a bad bug. The router used to fall through to the onboarding handler for
 * any unrecognised text, and with no conversation row it replied "you are not
 * registered yet" to people who had just finished registering.
 *
 * Replies go **through the outbox** like everything else rather than being sent
 * inline, so ordering holds: "you are confirmed" must never arrive after "you
 * are no longer needed". The caller drains immediately after handling an update,
 * so that costs nothing in latency.
 */

import { locationNodes } from '@blood-connect/db';
import { addDays } from '@blood-connect/domain';
import { asc, eq } from 'drizzle-orm';

import type { BotContext } from './context.js';
import { MESSAGES } from './messages.js';
import { enqueue, type QueuedMessage } from './outbox.js';
import type { ChannelAddress, IncomingUpdate, OutgoingMessage } from './ports/channel.js';
import {
  acceptRequest,
  answerScreeningQuestion,
  declineRequest,
} from './use-cases/journey.js';
import { standingFor } from './use-cases/needs.js';
import {
  advanceOnboarding,
  beginOnboarding,
  deleteDonorData,
  findDonorByAddress,
  loadState,
  optOutDonor,
  promptFor,
  resumeDonor,
  snoozeDonor,
} from './use-cases/onboarding.js';

/** How long "pause" lasts before a donor is asked again. */
const SNOOZE_DAYS = 90;

async function districts(ctx: BotContext): Promise<{ id: string; name: string }[]> {
  return ctx.db
    .select({ id: locationNodes.id, name: locationNodes.name })
    .from(locationNodes)
    .where(eq(locationNodes.level, 'district'))
    .orderBy(asc(locationNodes.name));
}

/** Queues replies, keyed so a redelivered update writes nothing twice. */
async function reply(
  ctx: BotContext,
  to: ChannelAddress,
  messages: readonly OutgoingMessage[],
  updateId: string,
): Promise<void> {
  const queued: QueuedMessage[] = messages.map((message, index) => ({
    to,
    kind: 'reply' as const,
    message,
    dedupeKey: `reply:${to.channel}:${to.channelUserId}:${updateId}:${String(index)}`,
  }));

  await ctx.db.transaction(async (tx) => {
    await enqueue(tx, ctx.ids, queued, ctx.clock.now());
  });
}

/* -------------------------------------------------------------------------- */
/* What a registered donor sees                                                */
/* -------------------------------------------------------------------------- */

/**
 * Their own situation, and what is open that they could answer.
 *
 * This is the default reply for a registered donor — the answer to "so what
 * now?", which is what somebody who has just finished a minute of questions is
 * actually asking. Never "you are not registered".
 */
async function standingMessage(
  ctx: BotContext,
  donorId: string,
): Promise<OutgoingMessage> {
  const standing = await standingFor(ctx, donorId);
  if (!standing) return { text: MESSAGES.help };

  const lines: string[] = [];

  if (standing.pausedUntil !== null) {
    lines.push(MESSAGES.paused(standing.pausedUntil));
  } else if (standing.eligibleFrom !== null) {
    // The reason they are not being asked, said before the list — otherwise an
    // empty list reads as "nobody needs blood", which is not what it means.
    lines.push(MESSAGES.notEligibleYet(standing.eligibleFrom));
  }

  if (standing.needs.length === 0) {
    lines.push(MESSAGES.nothingNeeded(standing.bloodGroup));
  } else {
    lines.push(MESSAGES.needsHeading(standing.needs.length));
    for (const need of standing.needs) {
      lines.push(
        MESSAGES.needLine(
          need.bloodGroup,
          need.unitsOutstanding,
          need.neededBy,
          need.hospital,
        ) + (need.alreadyAsked ? ` — ${MESSAGES.alreadyAsked}` : ''),
      );
    }
    if (standing.pausedUntil === null && standing.eligibleFrom === null) {
      lines.push('\nWe will message you if one of these is a match for you.');
    }
  }

  return { text: lines.join('\n') };
}

/* -------------------------------------------------------------------------- */
/* The router                                                                  */
/* -------------------------------------------------------------------------- */

export async function handleUpdate(ctx: BotContext, update: IncomingUpdate): Promise<void> {
  const address = update.address;

  // A tap on a request card is answerable whatever state the person is in, so
  // it is handled before anything else looks them up.
  if (update.kind === 'choice' && isJourneyChoice(update.data)) {
    await handleJourneyChoice(ctx, address, update.data, update.updateId);
    return;
  }

  const donor = await findDonorByAddress(ctx, address);
  const said = update.kind === 'text' ? update.text.trim() : update.data;

  /* ------------------------------------------------ a registered donor */
  if (donor) {
    await handleRegistered(ctx, address, donor.donorId, said, update.updateId);
    return;
  }

  /* ------------------------------------------ somebody part-way through */
  const state = await loadState(ctx, address);
  if (state) {
    await handleOnboardingInput(ctx, address, said, update.updateId);
    return;
  }

  /* --------------------------------------------------- somebody new ---- */
  /**
   * No command needed. Whatever they said, the useful reply is the welcome and
   * the first question — asking somebody to type `/start` first is a step that
   * exists for the system's convenience, not theirs.
   */
  const begun = await beginOnboarding(ctx, address);
  await reply(
    ctx,
    address,
    begun.ok
      ? [{ text: MESSAGES.welcome }, promptFor('name')]
      : [{ text: begun.error.message }],
    update.updateId,
  );
}

const JOURNEY_VERBS = ['accept', 'decline', 'screen'] as const;

const isJourneyChoice = (data: string): boolean =>
  (JOURNEY_VERBS as readonly string[]).includes(data.split(':')[0] ?? '');

async function handleJourneyChoice(
  ctx: BotContext,
  address: ChannelAddress,
  data: string,
  updateId: string,
): Promise<void> {
  const [verb, ...rest] = data.split(':');
  const argument = rest.join(':');

  if (verb === 'accept') {
    const result = await acceptRequest(ctx, argument);
    await reply(
      ctx,
      address,
      [
        result.ok
          ? question(argument, 0, result.value.nextQuestion ?? '')
          : { text: result.error.message },
      ],
      updateId,
    );
    return;
  }

  if (verb === 'decline') {
    const result = await declineRequest(ctx, argument);
    await reply(
      ctx,
      address,
      [{ text: result.ok ? MESSAGES.declined : result.error.message }],
      updateId,
    );
    return;
  }

  const [journeyId, rawIndex, answer] = argument.split(':');
  const index = Number(rawIndex);
  if (!journeyId || Number.isNaN(index) || (answer !== 'yes' && answer !== 'no')) {
    await reply(ctx, address, [{ text: MESSAGES.help }], updateId);
    return;
  }

  const result = await answerScreeningQuestion(ctx, journeyId, index, answer);
  if (!result.ok) {
    await reply(ctx, address, [{ text: result.error.message }], updateId);
    return;
  }

  const step = result.value;
  const message: OutgoingMessage =
    step.kind === 'question'
      ? question(journeyId, step.index, step.text)
      : step.kind === 'deferred'
        ? { text: MESSAGES.deferred }
        : step.kind === 'waitlisted'
          ? { text: MESSAGES.waitlisted }
          : { text: MESSAGES.confirmed(step.hospital, step.neededBy) };

  await reply(ctx, address, [message], updateId);
}

const question = (journeyId: string, index: number, text: string): OutgoingMessage => ({
  text,
  choices: [
    { label: 'Yes', data: `screen:${journeyId}:${String(index)}:yes` },
    { label: 'No', data: `screen:${journeyId}:${String(index)}:no` },
  ],
});

/* -------------------------------------------------------------------------- */
/* Registered                                                                  */
/* -------------------------------------------------------------------------- */

async function handleRegistered(
  ctx: BotContext,
  address: ChannelAddress,
  donorId: string,
  said: string,
  updateId: string,
): Promise<void> {
  const word = said.toLowerCase().replace(/^\//, '');

  if (word === 'delete:confirm' || said === `delete:${donorId}`) {
    await deleteDonorData(ctx, donorId);
    await reply(ctx, address, [{ text: MESSAGES.deleted }], updateId);
    return;
  }
  if (said === 'cancel:delete') {
    await reply(ctx, address, [{ text: MESSAGES.deletionCancelled }], updateId);
    return;
  }

  if (word === 'pause') {
    const until = addDays(ctx.clock.today(), SNOOZE_DAYS);
    await snoozeDonor(ctx, donorId, until);
    await reply(ctx, address, [{ text: MESSAGES.snoozed(until) }], updateId);
    return;
  }

  if (word === 'resume' || word === 'start') {
    // "start" from somebody already registered is not a re-registration — it is
    // almost always somebody looking for the menu, or coming back after a pause.
    await resumeDonor(ctx, donorId);
    await reply(
      ctx,
      address,
      [{ text: MESSAGES.resumed }, await standingMessage(ctx, donorId)],
      updateId,
    );
    return;
  }

  if (word === 'stop') {
    await optOutDonor(ctx, donorId);
    await reply(ctx, address, [{ text: MESSAGES.optedOut }], updateId);
    return;
  }

  if (word === 'delete') {
    // Said plainly **before** deleting, in one sentence (§5).
    await reply(
      ctx,
      address,
      [
        {
          text: MESSAGES.confirmDeletion,
          choices: [
            { label: 'Yes, delete everything', data: `delete:${donorId}` },
            { label: 'No, keep my details', data: 'cancel:delete' },
          ],
        },
      ],
      updateId,
    );
    return;
  }

  if (word === 'help') {
    await reply(ctx, address, [{ text: MESSAGES.help }], updateId);
    return;
  }

  // Anything else: their own situation. Useful, and never a contradiction.
  await reply(ctx, address, [await standingMessage(ctx, donorId)], updateId);
}

/* -------------------------------------------------------------------------- */
/* Onboarding                                                                  */
/* -------------------------------------------------------------------------- */

async function handleOnboardingInput(
  ctx: BotContext,
  address: ChannelAddress,
  input: string,
  updateId: string,
): Promise<void> {
  const result = await advanceOnboarding(ctx, address, input);

  if (result.kind === 'next') {
    const list = result.state.step === 'district' ? await districts(ctx) : [];
    await reply(ctx, address, [promptFor(result.state.step, list)], updateId);
    return;
  }

  if (result.kind === 'registered') {
    /**
     * Two messages, and the second is the point.
     *
     * "You are registered" on its own leaves somebody with nothing to do and no
     * idea whether anything will ever happen. What is open near them right now
     * answers that, and it is the state they will see from here on.
     */
    await reply(
      ctx,
      address,
      [
        { text: MESSAGES.registered(result.name) },
        await standingMessage(ctx, result.donorId),
      ],
      updateId,
    );
    return;
  }

  if (result.kind === 'abandoned') {
    await reply(ctx, address, [{ text: MESSAGES.abandoned }], updateId);
    return;
  }

  // A validation problem: say what is wrong and ask the same question again,
  // rather than leaving somebody staring at an error with no prompt.
  const list = result.step === 'district' ? await districts(ctx) : [];
  await reply(
    ctx,
    address,
    [{ text: result.message }, promptFor(result.step, list)],
    updateId,
  );
}

export { standingMessage };
