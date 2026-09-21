/**
 * Turning an incoming update into one use-case call (§3, §9.5).
 *
 * The equivalent of a route handler: it parses, dispatches, and formats a reply.
 * No rule lives here. Whether a donor may give, whether a place is still open,
 * whether a tap is a replay, are all decided inside a use case, on a
 * transaction. This file only decides what the person sees.
 *
 * **Routing is by the person's state, not by a command.** Somebody who has never
 * registered gets the first question, whatever they typed; somebody part-way
 * through gets the next one; somebody registered gets an answer about their own
 * situation. Nobody has to know that `/start` exists.
 *
 * That ordering, *who is this?* before *what did they say?*, is also the fix
 * for a bad bug. The router used to fall through to the onboarding handler for
 * any unrecognised text, and with no conversation row it replied "you are not
 * registered yet" to people who had just finished registering.
 *
 * Replies go **through the outbox** like everything else rather than being sent
 * inline, so ordering holds: "you are confirmed" must never arrive after "you
 * are no longer needed". The caller drains immediately after handling an update,
 * so that costs nothing in latency.
 */

import { addDays } from '@blood-connect/domain';

import type { BotContext } from './context.js';
import { MESSAGES } from './messages.js';
import { enqueue, type QueuedMessage } from './outbox.js';
import {
  INERT_CHOICE,
  type ChannelAddress,
  type Choice,
  type IncomingUpdate,
  type OutgoingMessage,
} from './ports/channel.js';
import {
  acceptRequest,
  answerScreeningQuestion,
  declineRequest,
} from './use-cases/journey.js';
import { standingFor } from './use-cases/needs.js';
import {
  journeyForBoardTap,
  openBoard,
  requestByPublicId,
  type Board,
} from './use-cases/board.js';
import { promptFor } from './use-cases/interview.js';
import {
  answerContact,
  answerInterview,
  beginInterview,
  loadInterview,
  type AnswerResult,
} from './use-cases/interview-flow.js';
import {
  deleteDonorData,
  draftFromProfile,
  findDonorByAddress,
  noteInterest,
  optOutDonor,
  resumeDonor,
  snoozeDonor,
} from './use-cases/self-service.js';

/** How long "pause" lasts before a donor is asked again. */
const SNOOZE_DAYS = 90;

/* -------------------------------------------------------------------------- */
/* The menu                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The standing menu, offered rather than memorised (§5, §8).
 *
 * Routing is still by state and not by command: every one of these taps arrives
 * as the same word somebody could have typed, and the router handles it in the
 * same branch. Nothing new can be reached only through a button, which is what
 * keeps the bot usable by somebody who types "needs" and never sees a keyboard
 * at all.
 *
 * The pause item flips to "start again" for a donor who is paused, because
 * offering to pause somebody who already has is a button that does nothing and
 * reads as a bug.
 */
function menuChoices(paused: boolean): Choice[] {
  return [
    { label: MESSAGES.menu.needs, data: 'needs' },
    { label: MESSAGES.menu.donate, data: 'donate' },
    { label: MESSAGES.menu.profile, data: 'profile' },
    paused
      ? { label: MESSAGES.menu.resume, data: 'resume' }
      : { label: MESSAGES.menu.pause, data: 'pause' },
    { label: MESSAGES.menu.help, data: 'help' },
  ];
}

/** The same menu under a message that has none of its own. */
const withMenu = (message: OutgoingMessage, paused: boolean): OutgoingMessage => ({
  ...message,
  choices: message.choices ?? menuChoices(paused),
});

/* -------------------------------------------------------------------------- */
/* Answered questions                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Turns the question somebody just answered into a record of their answer.
 *
 * The point is that a question can be answered **once**. Before this, every set
 * of buttons stayed live for ever: a donor could tap "Female" and then "Male"
 * on the same question, or answer a screening question twice while the reply to
 * the first was still in the outbox. The second tap was usually rejected
 * somewhere deeper, but the person saw a button that looked answerable and got
 * either silence or a contradiction.
 *
 * So the message they tapped is edited in place: the option they chose is
 * ticked, the rest are dimmed and made inert. The question stays on screen and
 * readable, which is why the alternatives are dimmed rather than removed.
 *
 * Only the buttons are edited, never the text (`editChoicesOnly`), so the
 * question keeps the exact wording they answered.
 *
 * **Correcting an answer is a different thing and stays fully live.** The fix
 * flow re-asks the original question as a new message with fresh, active
 * buttons, and locks that one in turn when it is answered. One question, one
 * answer, as many times as somebody wants to change their mind (§5).
 */
function lockAnswered(
  asked: OutgoingMessage,
  chosen: string,
  messageRef: string,
): OutgoingMessage | undefined {
  if (!asked.choices || asked.choices.length === 0) return undefined;
  // A tap that matches nothing on the message is a stale callback from an
  // older card. Locking on it would mark every option unavailable and none
  // chosen, which reads as "you answered, and we lost it".
  if (!asked.choices.some((choice) => choice.data === chosen)) return undefined;

  return {
    ...asked,
    replaces: messageRef,
    editChoicesOnly: true,
    choices: asked.choices.map((choice) => ({
      ...choice,
      state: choice.data === chosen ? ('chosen' as const) : ('unavailable' as const),
    })),
  };
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
 * This is the default reply for a registered donor. The answer to "so what
 * now?", which is what somebody who has just finished a minute of questions is
 * actually asking. Never "you are not registered".
 */
async function standingMessage(
  ctx: BotContext,
  donorId: string,
): Promise<OutgoingMessage> {
  const standing = await standingFor(ctx, donorId);
  if (!standing) return withMenu({ text: MESSAGES.help }, false);

  const lines: string[] = [];

  /**
   * The reason a message will never arrive, said before the list.
   *
   * First, because it outranks everything under it: a donor their answers put
   * outside the thresholds is in no wave, so "nothing is needed right now"
   * underneath would be true and completely misleading (§7.7).
   */
  if (standing.qualification !== 'qualified' && standing.qualificationReason) {
    lines.push(standing.qualificationReason);
    lines.push('');
  }

  if (standing.pausedUntil !== null) {
    lines.push(MESSAGES.paused(standing.pausedUntil));
  } else if (standing.eligibleFrom !== null) {
    // The reason they are not being asked, said before the list. Otherwise an
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
        ) + (need.alreadyAsked ? `: ${MESSAGES.alreadyAsked}` : ''),
      );
    }
    if (
      standing.pausedUntil === null &&
      standing.eligibleFrom === null &&
      standing.qualification === 'qualified'
    ) {
      lines.push('\nWe will message you if one of these is a match for you.');
    }
  }

  return withMenu({ text: lines.join('\n') }, standing.pausedUntil !== null);
}

/**
 * The demand board, as one message (§5).
 *
 * Open to everyone. A visitor asking "what is needed?" gets an answer, not a
 * signup form. A registered donor's matches lead the list and are marked; the
 * rest stay visible below, because "nothing for you" and "nothing at all" are
 * different facts and a donor should be able to tell them apart.
 */
function boardMessage(board: Board): OutgoingMessage {
  if (board.entries.length === 0) {
    return { text: MESSAGES.boardEmpty };
  }

  const lines = [
    MESSAGES.boardHeading(board.entries.length),
    '',
    ...board.entries.map((entry) =>
      MESSAGES.boardLine(
        entry.bloodGroup,
        entry.unitsOutstanding,
        entry.neededBy,
        entry.hospital,
        entry.matchesMe,
      ),
    ),
    '',
    MESSAGES.boardKey,
  ];

  const mine = board.entries.filter((entry) => entry.matchesMe && !entry.alreadyAsked);

  if (board.blocked !== null) {
    // Said once, and without a lecture (§5). The detail is a date for the two
    // reasons that name one, and the stored sentence for a donor whose answers
    // put them outside the thresholds.
    const detail =
      board.blocked.reason === 'interval' || board.blocked.reason === 'paused'
        ? board.blocked.until
        : board.blocked.reason === 'not_qualified'
          ? board.blocked.detail
          : '';
    lines.push('', MESSAGES.boardBlocked(board.blocked.reason, detail));
    return { text: lines.join('\n') };
  }

  if (mine.length === 0) return { text: lines.join('\n') };

  lines.push('', MESSAGES.boardTapPrompt);
  return {
    text: lines.join('\n'),
    /*
      Tapping a match enters the same accept → screen → confirm flow as a
      pushed card. §5 is explicit that there is one path and not two, so this
      offers `board:<publicId>` and the handler turns it into the same journey
      a wave would have created.
    */
    choices: mine.map((entry) => ({
      label: `Give ${entry.bloodGroup}: ${entry.hospital.hospitalName}`,
      data: `board:${entry.publicId}`,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* The router                                                                  */
/* -------------------------------------------------------------------------- */

export async function handleUpdate(ctx: BotContext, update: IncomingUpdate): Promise<void> {
  const address = update.address;

  /**
   * A tap on an option that has already been answered.
   *
   * Telegram delivers the tap whatever the button looks like, so a dimmed
   * option still arrives here. It is answered with silence on purpose: the
   * person tapped something visibly inert, and replying with their standing
   * situation would be a wall of text they did not ask for.
   */
  if (update.kind === 'choice' && update.data === INERT_CHOICE) return;

  // A tap on a request card is answerable whatever state the person is in, so
  // it is handled before anything else looks them up.
  if (update.kind === 'choice' && isJourneyChoice(update.data)) {
    await handleJourneyChoice(
      ctx,
      address,
      update.data,
      update.updateId,
      update.messageRef,
    );
    return;
  }

  // A tap on the board is the same: it turns into the same journey a wave
  // would have created, and then into the same questions (§5).
  if (update.kind === 'choice' && update.data.startsWith('board:')) {
    await handleBoardTap(ctx, address, update.data.slice(6), update.updateId);
    return;
  }

  const state = await loadInterview(ctx, address);

  /**
   * A shared contact answers exactly one question, and only while it is being
   * asked. Handled before the donor lookup because it arrives mid-interview,
   * when there is no donor row yet.
   */
  if (update.kind === 'contact') {
    if (state) {
      await showInterview(ctx, address, await answerContact(ctx, address, update.phone), update.updateId);
      return;
    }
    await reply(ctx, address, [{ text: MESSAGES.help }], update.updateId);
    return;
  }

  const said = update.kind === 'text' ? update.text.trim() : update.data;

  /* ------------------------------------------------------- a deep link */
  /**
   * "A donor arriving on a request link is onboarded first, then lands back on
   * that request: **the link is never lost**" (§5).
   *
   * The target is written onto the draft rather than held anywhere, so it
   * survives the whole interview, a restart, and a night's sleep.
   */
  const deepLink = deepLinkTarget(said);
  if (deepLink !== undefined) {
    await handleDeepLink(ctx, address, deepLink, update.updateId);
    return;
  }

  /* ------------------------------------------ somebody part-way through */
  /**
   * **Before** the donor lookup, not after.
   *
   * A registered donor editing their profile is in an interview, and answering
   * them with "here is what is needed near you" would silently drop the edit
   * they were half-way through.
   */
  if (state) {
    /*
      The question as it currently stands, captured **before** the answer is
      applied. After `answerInterview` the state has moved on and the prompt
      would describe the next question, so locking against it would tick a
      button on the wrong screen.
    */
    const asked = update.kind === 'choice' ? await promptFor(ctx, state) : undefined;
    const locked =
      asked && update.kind === 'choice'
        ? lockAnswered(asked, said, update.messageRef)
        : undefined;

    await showInterview(
      ctx,
      address,
      await answerInterview(ctx, address, said),
      update.updateId,
      locked,
    );
    return;
  }

  const donor = await findDonorByAddress(ctx, address);

  /* ------------------------------------------------ a registered donor */
  if (donor) {
    await handleRegistered(ctx, address, donor.donorId, said, update.updateId);
    return;
  }

  /* --------------------------------------------------- somebody new ---- */
  /**
   * No command needed. Whatever they said, the useful reply is the welcome and
   * the first question. Asking somebody to type `/start` first is a step that
   * exists for the system's convenience, not theirs.
   */
  const begun = await beginInterview(ctx, address);
  await reply(
    ctx,
    address,
    [{ text: MESSAGES.welcome }, await promptFor(ctx, begun)],
    update.updateId,
  );
}

const JOURNEY_VERBS = ['accept', 'decline', 'screen'] as const;

const isJourneyChoice = (data: string): boolean =>
  (JOURNEY_VERBS as readonly string[]).includes(data.split(':')[0] ?? '');

/**
 * The buttons that were on the message this tap came from.
 *
 * Rebuilt from the callback data rather than remembered, because a journey has
 * no conversation row to hold a copy in and a card can be tapped days after it
 * was sent, from a process that has restarted since. The labels are fixed
 * constants, so the data is enough to reconstruct exactly what was displayed.
 *
 * `undefined` for anything unrecognised, which leaves the buttons live rather
 * than locking a message this cannot describe correctly.
 */
function journeyChoicesFor(data: string): readonly Choice[] | undefined {
  const [verb, ...rest] = data.split(':');
  const argument = rest.join(':');

  if (verb === 'accept' || verb === 'decline') {
    return [
      { label: MESSAGES.cardYes, data: `accept:${argument}` },
      { label: MESSAGES.cardNo, data: `decline:${argument}` },
    ];
  }

  if (verb === 'screen') {
    const [journeyId, rawIndex] = argument.split(':');
    if (!journeyId || rawIndex === undefined) return undefined;
    return [
      { label: MESSAGES.answerYes, data: `screen:${journeyId}:${rawIndex}:yes` },
      { label: MESSAGES.answerNo, data: `screen:${journeyId}:${rawIndex}:no` },
    ];
  }

  return undefined;
}

async function handleJourneyChoice(
  ctx: BotContext,
  address: ChannelAddress,
  data: string,
  updateId: string,
  messageRef: string,
): Promise<void> {
  const [verb, ...rest] = data.split(':');
  const argument = rest.join(':');

  /*
    The card or question they just tapped, marked with the answer they gave, so
    neither of its two buttons can be pressed a second time (§8).
  */
  const asked = journeyChoicesFor(data);
  const locked = asked
    ? lockAnswered({ text: '', choices: asked }, data, messageRef)
    : undefined;
  const before = locked ? [locked] : [];

  if (verb === 'accept') {
    const result = await acceptRequest(ctx, argument);
    await reply(
      ctx,
      address,
      [
        ...before,
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
      [...before, { text: result.ok ? MESSAGES.declined : result.error.message }],
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
    // Refused, so the question is still open and its buttons stay live.
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

  await reply(ctx, address, [...before, message], updateId);
}

const question = (journeyId: string, index: number, text: string): OutgoingMessage => ({
  text,
  choices: [
    { label: MESSAGES.answerYes, data: `screen:${journeyId}:${String(index)}:yes` },
    { label: MESSAGES.answerNo, data: `screen:${journeyId}:${String(index)}:no` },
  ],
});

/* -------------------------------------------------------------------------- */
/* The board, and the link that leads to it                                    */
/* -------------------------------------------------------------------------- */

/**
 * The public id inside a deep link, if this is one.
 *
 * Telegram delivers `/start <payload>` when somebody opens `t.me/bot?start=x`,
 * which is why this is the one place a command word still matters. It is the
 * platform's wire format, not something a person is expected to type.
 */
function deepLinkTarget(said: string): string | undefined {
  const match = /^\/?start[ =]([A-Za-z0-9_-]{4,64})$/.exec(said.trim());
  return match?.[1];
}

async function handleDeepLink(
  ctx: BotContext,
  address: ChannelAddress,
  publicId: string,
  updateId: string,
): Promise<void> {
  const target = await requestByPublicId(ctx, publicId);
  const donor = await findDonorByAddress(ctx, address);

  if (!target) {
    // The request closed between the share and the tap, which is the common
    // case for a message forwarded around a family group.
    const board = await openBoard(ctx, donor?.donorId);
    await reply(ctx, address, [{ text: MESSAGES.linkGone }, boardMessage(board)], updateId);
    return;
  }

  /* --- already registered: straight to the card ----------------------- */
  if (donor) {
    const journeyId = await journeyForBoardTap(ctx, target.botRequestId, donor.donorId);
    if (journeyId === undefined) {
      // Two taps racing on the same link: the other one made the journey and
      // sent the card, so this one says nothing rather than sending a second.
      await reply(ctx, address, [{ text: MESSAGES.help }], updateId);
      return;
    }
    await reply(
      ctx,
      address,
      [requestCard(target.bloodGroup, target.neededBy, target.hospital, journeyId)],
      updateId,
    );
    return;
  }

  /**
   * A visitor: onboard first, holding the link **on the draft**.
   *
   * §5: "the link is never lost". Writing it into the interview state is what
   * makes that true across a restart and a night's sleep, rather than only
   * across the next few messages.
   */
  const state = await beginInterview(ctx, address, {
    draft: { returnToRequest: publicId },
  });
  await reply(
    ctx,
    address,
    [
      { text: MESSAGES.linkHeldForYou(target.bloodGroup, target.hospital) },
      await promptFor(ctx, state),
    ],
    updateId,
  );
}

/**
 * A tap on the board, which becomes the journey a wave would have made.
 *
 * One path, not two (§5): from here the donor sees the same card and answers
 * the same questions as somebody who was pushed it.
 */
async function handleBoardTap(
  ctx: BotContext,
  address: ChannelAddress,
  publicId: string,
  updateId: string,
): Promise<void> {
  const donor = await findDonorByAddress(ctx, address);
  const target = await requestByPublicId(ctx, publicId);

  if (!target) {
    await reply(ctx, address, [{ text: MESSAGES.linkGone }], updateId);
    return;
  }

  if (!donor) {
    // Onboard first, then come back to it. The same behaviour as a deep link.
    await handleDeepLink(ctx, address, publicId, updateId);
    return;
  }

  const journeyId = await journeyForBoardTap(ctx, target.botRequestId, donor.donorId);
  if (journeyId === undefined) {
    await reply(ctx, address, [{ text: MESSAGES.help }], updateId);
    return;
  }

  await reply(
    ctx,
    address,
    [requestCard(target.bloodGroup, target.neededBy, target.hospital, journeyId)],
    updateId,
  );
}

/** The request card. The same one a wave sends (§5). */
const requestCard = (
  bloodGroup: string,
  neededBy: string,
  hospital: { hospitalName: string; hospitalAddress: string },
  journeyId: string,
): OutgoingMessage => ({
  text: MESSAGES.request(bloodGroup, neededBy, hospital),
  choices: [
    { label: MESSAGES.cardYes, data: `accept:${journeyId}` },
    { label: MESSAGES.cardNo, data: `decline:${journeyId}` },
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
    const erased = await deleteDonorData(ctx, donorId);
    // What was kept, said plainly: a donation record the centre must keep is
    // not the donor's to delete, and hiding that would be a lie (§12.1).
    await reply(ctx, address, [{ text: MESSAGES.deleted(erased.donationsKept) }], updateId);
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
    // "start" from somebody already registered is not a re-registration. It is
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

  if (word === 'profile' || word === 'edit') {
    /**
     * **The identical summary and the identical checklist** (§5).
     *
     * The stored profile becomes an interview draft, and every prompt and every
     * fix path from here is the one signup already uses. There is one
     * implementation and two entry points, which is also why the acknowledgement
     * is re-recorded on save: the donor is agreeing to the summary in front of
     * them, not to a form they filled in months ago.
     */
    const draft = await draftFromProfile(ctx, donorId);
    if (!draft) {
      await reply(ctx, address, [{ text: MESSAGES.help }], updateId);
      return;
    }

    const state = await beginInterview(ctx, address, {
      flow: 'profile',
      donorId,
      draft: draft,
      step: 'summary',
    });
    await reply(ctx, address, [await promptFor(ctx, state)], updateId);
    return;
  }

  if (word === 'board' || word === 'needs' || word === 'requests') {
    await reply(ctx, address, [boardMessage(await openBoard(ctx, donorId))], updateId);
    return;
  }

  /**
   * "I would like to give", with nothing open that matches (§5).
   *
   * Somebody who came looking rather than waiting to be asked. It records the
   * offer on the event log and answers with the one fact that is true for them:
   * either they are in the pool, or something is standing in the way and this
   * is what it is. It deliberately creates **no journey**: a journey is a
   * commitment against a specific request, and there may be no request at all.
   *
   * Where it is going: a walk-in is recorded by the counter, not here. The bot
   * holds no grant to write the centre's own tables, which is the boundary of
   * §5.1 doing its job rather than an omission.
   */
  if (word === 'donate' || word === 'give') {
    const standing = await standingFor(ctx, donorId);
    await noteInterest(ctx, donorId);

    const blocked =
      standing && standing.qualification !== 'qualified' && standing.qualificationReason
        ? standing.qualificationReason
        : standing?.pausedUntil
          ? MESSAGES.paused(standing.pausedUntil)
          : standing?.eligibleFrom
            ? MESSAGES.notEligibleYet(standing.eligibleFrom)
            : null;

    await reply(
      ctx,
      address,
      [
        withMenu(
          {
            text:
              blocked === null
                ? MESSAGES.interestNoted
                : MESSAGES.interestBlocked(blocked),
          },
          standing?.pausedUntil !== null && standing?.pausedUntil !== undefined,
        ),
      ],
      updateId,
    );
    return;
  }

  if (word === 'help' || word === 'menu') {
    await reply(ctx, address, [withMenu({ text: MESSAGES.help }, false)], updateId);
    return;
  }

  // Anything else: their own situation. Useful, and never a contradiction.
  await reply(ctx, address, [await standingMessage(ctx, donorId)], updateId);
}

/* -------------------------------------------------------------------------- */
/* The interview                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Turns one interview outcome into what the donor sees.
 *
 * Every branch ends with a question or with an ending, never with a statement
 * that leaves somebody unsure whether to answer or to wait (§8).
 */
async function showInterview(
  ctx: BotContext,
  address: ChannelAddress,
  result: AnswerResult,
  updateId: string,
  /** The question they just answered, edited to show the answer (§8). */
  locked?: OutgoingMessage,
): Promise<void> {
  /*
    The lock goes first in every branch, so the question they answered settles
    before the next one arrives. The outbox preserves this order, which is the
    whole reason replies go through it rather than being sent inline.
  */
  const before = locked ? [locked] : [];

  if (result.kind === 'next') {
    await reply(ctx, address, [...before, await promptFor(ctx, result.state)], updateId);
    return;
  }

  if (result.kind === 'invalid') {
    /*
      Not locked: the answer was refused, so the question is still open and its
      buttons must stay live. Ticking an option that was not accepted would be
      a lie about what the system knows.
    */
    await reply(
      ctx,
      address,
      [{ text: result.message }, await promptFor(ctx, result.state)],
      updateId,
    );
    return;
  }

  if (result.kind === 'saved') {
    await reply(
      ctx,
      address,
      [...before, { text: MESSAGES.profileSaved }, await standingMessage(ctx, result.donorId)],
      updateId,
    );
    return;
  }

  if (result.kind === 'declined') {
    /**
     * Registered and dormant (§5, §8).
     *
     * Not the abandoned message: nothing was lost, and saying so would be
     * untrue. What they need is the one word that turns it on later.
     */
    await reply(
      ctx,
      address,
      [...before, { text: MESSAGES.registeredDormant(result.name) }],
      updateId,
    );
    return;
  }

  /* --- registered: where signup ends (§5) ----------------------------- */
  /**
   * Three endings, and which one they get is the difference between a donor who
   * waits for a message and one who thinks nothing happened.
   */
  const closing: OutgoingMessage = result.matchable.ok
    ? { text: MESSAGES.registeredMatchable(result.name, result.nextEligible) }
    : {
        text: MESSAGES.registeredNotMatchable(
          result.name,
          result.matchable.reason,
          result.matchable.until ?? null,
        ),
      };

  /**
   * Came in on a request link → **straight back to that request** (§5).
   *
   * "That is what they came for." The alternative, a generic list of what is
   * needed, loses the one person who already had a reason to act, which is
   * the most expensive donor in the system to lose.
   */
  if (result.returnToRequest !== undefined) {
    const target = await requestByPublicId(ctx, result.returnToRequest);
    if (target) {
      const journeyId = await journeyForBoardTap(ctx, target.botRequestId, result.donorId);
      await reply(
        ctx,
        address,
        [
          ...before,
          closing,
          { text: MESSAGES.linkResumed(target.bloodGroup, target.hospital) },
          ...(journeyId === undefined
            ? []
            : [requestCard(target.bloodGroup, target.neededBy, target.hospital, journeyId)]),
        ],
        updateId,
      );
      return;
    }
    // It closed while they were registering. Say so, then show what else there
    // is. An ending, not a dead end (§8).
    await reply(
      ctx,
      address,
      [
        ...before,
        closing,
        { text: MESSAGES.linkGone },
        await standingMessage(ctx, result.donorId),
      ],
      updateId,
    );
    return;
  }

  await reply(
    ctx,
    address,
    [...before, closing, await standingMessage(ctx, result.donorId)],
    updateId,
  );
}

export { standingMessage };
