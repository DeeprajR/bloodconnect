/**
 * Turning an incoming update into one use-case call (§3, §9.5).
 *
 * The equivalent of a route handler: it parses, dispatches, and formats a reply.
 * No rule lives here. Whether a donor may give, whether a place is still open,
 * whether a tap is a replay — all of that is decided inside a use case, on a
 * transaction, and this file only says what the person sees.
 *
 * Replies go **through the outbox** like everything else, rather than being sent
 * inline. A reply sent inline while the outbox holds a stand-down would arrive
 * out of order, and the ordering that matters — "you are confirmed" before "you
 * are no longer needed" — is the one a donor would act on.
 */

import { locationNodes } from '@blood-connect/db';
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
import {
  advanceOnboarding,
  beginOnboarding,
  deleteDonorData,
  findDonorByAddress,
  optOutDonor,
  promptFor,
  snoozeDonor,
} from './use-cases/onboarding.js';
import { addDays } from '@blood-connect/domain';

/** How long "pause" lasts before a donor is asked again. */
const SNOOZE_DAYS = 90;

async function districts(ctx: BotContext): Promise<{ id: string; name: string }[]> {
  return ctx.db
    .select({ id: locationNodes.id, name: locationNodes.name })
    .from(locationNodes)
    .where(eq(locationNodes.level, 'district'))
    .orderBy(asc(locationNodes.name));
}

/** Queues one reply, keyed so a redelivered update writes nothing twice. */
async function reply(
  ctx: BotContext,
  to: ChannelAddress,
  message: OutgoingMessage,
  updateId: string,
): Promise<void> {
  const queued: QueuedMessage = {
    to,
    kind: 'reply',
    message,
    dedupeKey: `reply:${to.channel}:${to.channelUserId}:${updateId}`,
  };

  await ctx.db.transaction(async (tx) => {
    await enqueue(tx, ctx.ids, [queued], ctx.clock.now());
  });
}

/**
 * Handles one update.
 *
 * Every branch ends by queueing exactly one reply, because a person who taps a
 * button and sees nothing assumes it did not work and taps again.
 */
export async function handleUpdate(ctx: BotContext, update: IncomingUpdate): Promise<void> {
  const address = update.address;

  /* ------------------------------------------------------ tapped choices */
  if (update.kind === 'choice') {
    const [verb, ...rest] = update.data.split(':');
    const argument = rest.join(':');

    if (verb === 'accept') {
      const result = await acceptRequest(ctx, argument);
      await reply(
        ctx,
        address,
        result.ok
          ? {
              text: result.value.nextQuestion ?? MESSAGES.unknown,
              choices: [
                { label: 'Yes', data: `screen:${argument}:0:yes` },
                { label: 'No', data: `screen:${argument}:0:no` },
              ],
            }
          : { text: result.error.message },
        update.updateId,
      );
      return;
    }

    if (verb === 'decline') {
      const result = await declineRequest(ctx, argument);
      await reply(
        ctx,
        address,
        { text: result.ok ? MESSAGES.declined : result.error.message },
        update.updateId,
      );
      return;
    }

    if (verb === 'screen') {
      const [journeyId, rawIndex, answer] = argument.split(':');
      const index = Number(rawIndex);
      if (!journeyId || Number.isNaN(index) || (answer !== 'yes' && answer !== 'no')) {
        await reply(ctx, address, { text: MESSAGES.unknown }, update.updateId);
        return;
      }

      const result = await answerScreeningQuestion(ctx, journeyId, index, answer);
      if (!result.ok) {
        await reply(ctx, address, { text: result.error.message }, update.updateId);
        return;
      }

      const step = result.value;
      const message: OutgoingMessage =
        step.kind === 'question'
          ? {
              text: step.text,
              choices: [
                { label: 'Yes', data: `screen:${journeyId}:${String(step.index)}:yes` },
                { label: 'No', data: `screen:${journeyId}:${String(step.index)}:no` },
              ],
            }
          : step.kind === 'deferred'
            ? { text: MESSAGES.deferred }
            : step.kind === 'waitlisted'
              ? { text: MESSAGES.waitlisted }
              : { text: MESSAGES.confirmed(step.hospital, step.neededBy) };

      await reply(ctx, address, message, update.updateId);
      return;
    }

    // An onboarding choice — sex, group, weight, district, consent.
    await handleOnboardingInput(ctx, address, update.data, update.updateId);
    return;
  }

  /* ------------------------------------------------------- typed messages */
  const text = update.text.trim().toLowerCase();

  if (text === 'start' || text === '/start') {
    const existing = await findDonorByAddress(ctx, address);
    if (existing) {
      await reply(ctx, address, { text: MESSAGES.help }, update.updateId);
      return;
    }
    const begun = await beginOnboarding(ctx, address);
    await reply(
      ctx,
      address,
      begun.ok
        ? { text: `${MESSAGES.welcome}\n\n${MESSAGES.askName}` }
        : { text: begun.error.message },
      update.updateId,
    );
    return;
  }

  if (text === 'help' || text === '/help') {
    await reply(ctx, address, { text: MESSAGES.help }, update.updateId);
    return;
  }

  if (text === 'pause' || text === 'stop' || text === 'delete') {
    const donor = await findDonorByAddress(ctx, address);
    if (!donor) {
      await reply(ctx, address, { text: MESSAGES.notRegistered }, update.updateId);
      return;
    }

    if (text === 'pause') {
      const until = addDays(ctx.clock.today(), SNOOZE_DAYS);
      await snoozeDonor(ctx, donor.donorId, until);
      await reply(ctx, address, { text: MESSAGES.snoozed(until) }, update.updateId);
      return;
    }

    if (text === 'stop') {
      await optOutDonor(ctx, donor.donorId);
      await reply(ctx, address, { text: MESSAGES.optedOut }, update.updateId);
      return;
    }

    // Said plainly **before** deleting, in one sentence (§5).
    await reply(
      ctx,
      address,
      {
        text: MESSAGES.confirmDeletion,
        choices: [
          { label: 'Yes, delete everything', data: `delete:${donor.donorId}` },
          { label: 'No, keep my details', data: 'cancel:delete' },
        ],
      },
      update.updateId,
    );
    return;
  }

  // Anything else during onboarding is an answer to the current question.
  await handleOnboardingInput(ctx, address, update.text, update.updateId);
}

async function handleOnboardingInput(
  ctx: BotContext,
  address: ChannelAddress,
  input: string,
  updateId: string,
): Promise<void> {
  if (input.startsWith('delete:')) {
    await deleteDonorData(ctx, input.slice('delete:'.length));
    await reply(ctx, address, { text: MESSAGES.deleted }, updateId);
    return;
  }
  if (input === 'cancel:delete') {
    await reply(ctx, address, { text: 'Nothing was deleted.' }, updateId);
    return;
  }

  const result = await advanceOnboarding(ctx, address, input);

  if (result.kind === 'next') {
    const list = result.state.step === 'district' ? await districts(ctx) : [];
    await reply(ctx, address, promptFor(result.state.step, list), updateId);
    return;
  }

  if (result.kind === 'registered') {
    await reply(
      ctx,
      address,
      { text: MESSAGES.registered(result.nextEligible) },
      updateId,
    );
    return;
  }

  if (result.kind === 'abandoned') {
    await reply(ctx, address, { text: MESSAGES.abandoned }, updateId);
    return;
  }

  await reply(ctx, address, { text: result.message }, updateId);
}
