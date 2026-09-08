/**
 * One donor's journey through one request (§7.3, §7.4, §8.4).
 *
 * Every transition here is a **conditional UPDATE guarded on the status it
 * expects**, reporting whether it actually moved. That is not defensive style;
 * it is what makes a redelivered chat callback a no-op. Chat platforms redeliver
 * — a tap that timed out, a network retry, a card somebody found in their
 * history a week later — and a read-then-write would process each one again.
 *
 * The claim on the last unit (§7.3) is the sharpest case: two donors finishing
 * screening in the same instant contend on one row, exactly one matches, and the
 * other is waitlisted rather than being asked six questions for a place that no
 * longer exists.
 */

import { and, eq, sql } from 'drizzle-orm';
import {
  botRequests,
  donorChannels,
  donorRequests,
  donorScreeningAnswers,
  donors,
} from '@blood-connect/db/bot';
import { donorDemandConfirmations } from '@blood-connect/db';
import { err, ok, type Result } from '@blood-connect/result';

import type { BotContext } from '../context.js';
import { createEventWriter } from '../events.js';
import { MESSAGES, type HospitalSnapshot } from '../messages.js';
import { enqueue, type QueuedMessage } from '../outbox.js';
import {
  QUESTION_COUNT,
  defersOn,
  durableAnswersFrom,
  isPermanentDeferral,
  questionAt,
} from '../screening.js';

export type JourneyError =
  | { readonly kind: 'JourneyNotFound'; readonly message: string }
  /** The transition did not apply. A replay, and therefore not a fault. */
  | { readonly kind: 'AlreadyMoved'; readonly message: string }
  | { readonly kind: 'RequestClosed'; readonly message: string };

const journeyNotFound: JourneyError = {
  kind: 'JourneyNotFound',
  message: 'No such request for you.',
};
const alreadyMoved: JourneyError = {
  kind: 'AlreadyMoved',
  message: MESSAGES.alreadyAnswered,
};
const requestClosed: JourneyError = {
  kind: 'RequestClosed',
  message: MESSAGES.requestClosed,
};

type JourneyRow = {
  id: string;
  botRequestId: string;
  donorId: string;
  status: string;
  screeningIndex: number;
  screeningAnswers: unknown;
};

/** Where to reach the donor on this journey. */
async function addressFor(
  ctx: BotContext,
  donorId: string,
): Promise<{ channel: string; channelUserId: string } | undefined> {
  const [row] = await ctx.db
    .select({ channel: donorChannels.channel, channelUserId: donorChannels.channelUserId })
    .from(donorChannels)
    .where(eq(donorChannels.donorId, donorId));
  return row;
}

/* -------------------------------------------------------------------------- */
/* Accept and decline                                                          */
/* -------------------------------------------------------------------------- */

export type AcceptResult = {
  readonly nextQuestion: string | null;
  readonly questionIndex: number;
};

/**
 * `NOTIFIED → ACCEPTED → SCREENING`, in one step (§7.4).
 *
 * A redelivered tap matches nothing and is reported as `AlreadyMoved`, which the
 * adapter turns into "you have already answered this one" rather than restarting
 * the questionnaire from the top.
 */
export async function acceptRequest(
  ctx: BotContext,
  journeyId: string,
): Promise<Result<AcceptResult, JourneyError>> {
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const moved = await tx
      .update(donorRequests)
      .set({ status: 'SCREENING', respondedAt: now, screeningIndex: 0 })
      .where(and(eq(donorRequests.id, journeyId), eq(donorRequests.status, 'NOTIFIED')))
      .returning({ id: donorRequests.id, botRequestId: donorRequests.botRequestId });

    if (moved.length === 0) return err(alreadyMoved);

    const event = createEventWriter(tx, ctx.correlationId, now);
    await event({
      event: 'journey.accepted',
      subjectType: 'donor_request',
      subjectId: journeyId,
    });

    const question = questionAt(0);
    return ok({ nextQuestion: question?.text ?? null, questionIndex: 0 });
  });
}

export async function declineRequest(
  ctx: BotContext,
  journeyId: string,
): Promise<Result<Record<string, never>, JourneyError>> {
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const moved = await tx
      .update(donorRequests)
      .set({ status: 'DECLINED', respondedAt: now, terminalAt: now })
      .where(and(eq(donorRequests.id, journeyId), eq(donorRequests.status, 'NOTIFIED')))
      .returning({ id: donorRequests.id });

    if (moved.length === 0) return err(alreadyMoved);

    const event = createEventWriter(tx, ctx.correlationId, now);
    // No reason is recorded, and none is asked for. "Why not?" after a no is
    // pressure, and the answer changes nothing this system does.
    await event({
      event: 'journey.declined',
      subjectType: 'donor_request',
      subjectId: journeyId,
    });

    return ok({});
  });
}

/* -------------------------------------------------------------------------- */
/* Screening                                                                   */
/* -------------------------------------------------------------------------- */

export type ScreeningStep =
  | { readonly kind: 'question'; readonly text: string; readonly index: number }
  | { readonly kind: 'deferred'; readonly permanent: boolean }
  | { readonly kind: 'confirmed'; readonly hospital: HospitalSnapshot; readonly neededBy: string }
  | { readonly kind: 'waitlisted' };

/**
 * Records one answer and returns what happens next.
 *
 * The index is compared against `screening_index` **on the row**, so a duplicate
 * tap on question three is recognised as already answered (§7.4) — and the flow
 * survives a process restart, because the progress is in the database rather
 * than in session memory.
 */
export async function answerScreeningQuestion(
  ctx: BotContext,
  journeyId: string,
  index: number,
  answer: 'yes' | 'no',
): Promise<Result<ScreeningStep, JourneyError>> {
  const now = ctx.clock.now();

  const [journey] = await ctx.db
    .select({
      id: donorRequests.id,
      botRequestId: donorRequests.botRequestId,
      donorId: donorRequests.donorId,
      status: donorRequests.status,
      screeningIndex: donorRequests.screeningIndex,
      screeningAnswers: donorRequests.screeningAnswers,
    })
    .from(donorRequests)
    .where(eq(donorRequests.id, journeyId));

  if (!journey) return err(journeyNotFound);
  if (journey.status !== 'SCREENING') return err(alreadyMoved);
  // A tap on a question they have already passed, or one they have not reached.
  if (journey.screeningIndex !== index) return err(alreadyMoved);

  const question = questionAt(index);
  if (!question) return err(alreadyMoved);

  const answers = {
    ...(journey.screeningAnswers as Record<string, string>),
    [question.key]: answer,
  };

  /* --- a deferral ends the journey, kindly ----------------------------- */
  if (defersOn(question, answer)) {
    const permanent = isPermanentDeferral(question.key);

    return ctx.db.transaction(async (tx) => {
      const moved = await tx
        .update(donorRequests)
        .set({
          status: 'DEFERRED',
          terminalAt: now,
          screeningAnswers: answers,
          screeningIndex: index + 1,
        })
        .where(
          and(
            eq(donorRequests.id, journeyId),
            eq(donorRequests.status, 'SCREENING'),
            eq(donorRequests.screeningIndex, index),
          ),
        )
        .returning({ id: donorRequests.id });

      if (moved.length === 0) return err(alreadyMoved);

      // Only the durable, flagging answers reach the profile (§5). A "no, I
      // have never had hepatitis" is not written anywhere.
      const durable = durableAnswersFrom(answers);
      if (durable.length > 0) {
        await tx
          .insert(donorScreeningAnswers)
          .values(
            durable.map((entry) => ({
              donorId: journey.donorId,
              questionKey: entry.questionKey,
              answer: entry.answer,
              answeredAt: now,
            })),
          )
          .onConflictDoNothing();
      }

      if (permanent) {
        // Not a rejection: a flag that stops them being asked again about
        // something they cannot change. Being asked repeatedly would be worse
        // than not being asked.
        await tx
          .update(donors)
          .set({ durableFlagStatus: 'flagged' })
          .where(eq(donors.id, journey.donorId));
      }

      const event = createEventWriter(tx, ctx.correlationId, now);
      await event({
        event: 'journey.deferred',
        subjectType: 'donor_request',
        subjectId: journeyId,
        // The question key, never the answer: an answer here is a health datum
        // and the event log is not the place for one (§11.9, §12).
        metadata: { questionKey: question.key, permanent },
      });

      return ok({ kind: 'deferred' as const, permanent });
    });
  }

  /* --- more questions to go -------------------------------------------- */
  const nextIndex = index + 1;
  if (nextIndex < QUESTION_COUNT) {
    const moved = await ctx.db
      .update(donorRequests)
      .set({ screeningIndex: nextIndex, screeningAnswers: answers })
      .where(
        and(
          eq(donorRequests.id, journeyId),
          eq(donorRequests.status, 'SCREENING'),
          eq(donorRequests.screeningIndex, index),
        ),
      )
      .returning({ id: donorRequests.id });

    if (moved.length === 0) return err(alreadyMoved);

    const next = questionAt(nextIndex);
    return ok({ kind: 'question' as const, text: next?.text ?? '', index: nextIndex });
  }

  /* --- through the questionnaire: claim a unit -------------------------- */
  return claimUnit(ctx, journey, answers);
}

/**
 * §7.3, the claim on the last unit.
 *
 * ```sql
 * UPDATE bot.bot_requests
 *    SET confirmed_count = confirmed_count + 1
 *  WHERE id = $req AND confirmed_count < units_needed
 * RETURNING confirmed_count;
 * ```
 *
 * One conditional UPDATE, never a read-then-write. Two donors finishing at the
 * same instant contend on one row: exactly one matches and is confirmed, the
 * other gets zero rows and is waitlisted. A read followed by a write would let
 * both see "2 of 3" and both confirm, and the fourth person to arrive at the
 * counter is turned away having travelled there.
 *
 * The confirmation row and the journey transition ride in the same transaction
 * as the successful UPDATE, so the centre's roster and the bot's count can never
 * disagree.
 */
async function claimUnit(
  ctx: BotContext,
  journey: JourneyRow,
  answers: Readonly<Record<string, string>>,
): Promise<Result<ScreeningStep, JourneyError>> {
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(botRequests)
      .where(eq(botRequests.id, journey.botRequestId));

    if (!request) return err(journeyNotFound);
    if (request.status !== 'open' && request.status !== 'fulfilled') {
      return err(requestClosed);
    }

    const snapshot = request.hospitalSnapshot as HospitalSnapshot;

    const claimed = await tx
      .update(botRequests)
      .set({ confirmedCount: sql`${botRequests.confirmedCount} + 1` })
      .where(
        and(
          eq(botRequests.id, journey.botRequestId),
          sql`${botRequests.confirmedCount} < ${botRequests.unitsNeeded}`,
        ),
      )
      .returning({ confirmed: botRequests.confirmedCount, needed: botRequests.unitsNeeded });

    const durable = durableAnswersFrom(answers);
    if (durable.length > 0) {
      await tx
        .insert(donorScreeningAnswers)
        .values(
          durable.map((entry) => ({
            donorId: journey.donorId,
            questionKey: entry.questionKey,
            answer: entry.answer,
            answeredAt: now,
          })),
        )
        .onConflictDoNothing();
    }

    const event = createEventWriter(tx, ctx.correlationId, now);

    /* --- the loser: waitlisted, and told so as good news --------------- */
    if (claimed.length === 0) {
      const moved = await tx
        .update(donorRequests)
        .set({
          status: 'REQUEST_FILLED',
          screeningAnswers: answers,
          screeningIndex: QUESTION_COUNT,
        })
        .where(
          and(eq(donorRequests.id, journey.id), eq(donorRequests.status, 'SCREENING')),
        )
        .returning({ id: donorRequests.id });

      if (moved.length === 0) return err(alreadyMoved);

      await tx
        .update(botRequests)
        .set({ waitlistedCount: sql`${botRequests.waitlistedCount} + 1` })
        .where(eq(botRequests.id, journey.botRequestId));

      await event({
        event: 'journey.waitlisted',
        subjectType: 'donor_request',
        subjectId: journey.id,
      });

      return ok({ kind: 'waitlisted' as const });
    }

    /* --- the winner: confirmed ----------------------------------------- */
    const moved = await tx
      .update(donorRequests)
      .set({
        status: 'CONFIRMED',
        confirmedAt: now,
        screeningAnswers: answers,
        screeningIndex: QUESTION_COUNT,
      })
      .where(and(eq(donorRequests.id, journey.id), eq(donorRequests.status, 'SCREENING')))
      .returning({ id: donorRequests.id });

    if (moved.length === 0) return err(alreadyMoved);

    const [donor] = await tx
      .select({
        name: donors.name,
        bloodGroup: donors.bloodGroup,
      })
      .from(donors)
      .where(eq(donors.id, journey.donorId));

    const [channel] = await tx
      .select({ channel: donorChannels.channel, channelUserId: donorChannels.channelUserId })
      .from(donorChannels)
      .where(eq(donorChannels.donorId, journey.donorId));

    const [phone] = await tx
      .select({ e164: sql<string>`e164` })
      .from(sql`bot.donor_phones`)
      .where(sql`donor_id = ${journey.donorId} AND verified`);

    /**
     * The roster row, in `hospital` (§7).
     *
     * This is the only place a donor's name and phone number cross into the
     * centre's half of the database, and it happens exactly when the person has
     * agreed to give blood for a specific patient — which is what the consent
     * text says (§5).
     */
    await tx
      .insert(donorDemandConfirmations)
      .values({
        id: ctx.ids.next<'ConfirmationId'>(),
        demandId: request.demandId,
        // The bot's **internal** donor id, not a platform user id (§2.11).
        donorId: journey.donorId,
        channel: channel?.channel ?? ctx.channel.default.name,
        donorName: donor?.name ?? 'Donor',
        donorPhone: phone?.e164 ?? 'not verified',
        bloodGroup: donor?.bloodGroup ?? request.bloodGroup,
        confirmedAt: now,
        status: 'confirmed',
      })
      .onConflictDoNothing();

    // Fulfilled once every unit is spoken for. The bot owns this edge; the
    // centre never declares a demand fulfilled (`packages/contract`).
    const confirmed = claimed[0]?.confirmed ?? 0;
    const needed = claimed[0]?.needed ?? 0;
    if (confirmed >= needed) {
      await tx
        .update(botRequests)
        .set({ status: 'fulfilled', nextWaveAt: null })
        .where(and(eq(botRequests.id, journey.botRequestId), eq(botRequests.status, 'open')));
    }

    await event({
      event: 'journey.confirmed',
      subjectType: 'donor_request',
      subjectId: journey.id,
      metadata: { donorId: journey.donorId, confirmed, needed },
    });

    return ok({
      kind: 'confirmed' as const,
      hospital: snapshot,
      neededBy: request.neededBy,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Waitlist promotion                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Fills a freed place from the waitlist (§5).
 *
 * A waitlist that never resolves is worse than never offering one, so this is
 * built in the same phase as the waitlisting itself rather than left as a
 * follow-up. The claim is the same conditional UPDATE as §7.3 — a place is
 * freed and a person takes it, and two promotions racing cannot both win.
 */
export async function promoteFromWaitlist(
  ctx: BotContext,
  botRequestId: string,
): Promise<{ promoted: number }> {
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(botRequests)
      .where(eq(botRequests.id, botRequestId));

    if (!request) return { promoted: 0 };
    if (request.status !== 'open' && request.status !== 'fulfilled') return { promoted: 0 };

    const waiting = await tx
      .select({ id: donorRequests.id, donorId: donorRequests.donorId })
      .from(donorRequests)
      .where(
        and(
          eq(donorRequests.botRequestId, botRequestId),
          eq(donorRequests.status, 'REQUEST_FILLED'),
        ),
      )
      .orderBy(donorRequests.createdAt);

    const messages: QueuedMessage[] = [];
    let promoted = 0;

    for (const candidate of waiting) {
      const claimed = await tx
        .update(botRequests)
        .set({ confirmedCount: sql`${botRequests.confirmedCount} + 1` })
        .where(
          and(
            eq(botRequests.id, botRequestId),
            sql`${botRequests.confirmedCount} < ${botRequests.unitsNeeded}`,
          ),
        )
        .returning({ confirmed: botRequests.confirmedCount });

      if (claimed.length === 0) break;

      const moved = await tx
        .update(donorRequests)
        .set({ status: 'CONFIRMED', confirmedAt: now })
        .where(
          and(
            eq(donorRequests.id, candidate.id),
            eq(donorRequests.status, 'REQUEST_FILLED'),
          ),
        )
        .returning({ id: donorRequests.id });

      if (moved.length === 0) {
        // Give the unit back: this donor moved underneath us.
        await tx
          .update(botRequests)
          .set({ confirmedCount: sql`${botRequests.confirmedCount} - 1` })
          .where(eq(botRequests.id, botRequestId));
        continue;
      }

      await tx
        .update(botRequests)
        .set({ waitlistedCount: sql`greatest(0, ${botRequests.waitlistedCount} - 1)` })
        .where(eq(botRequests.id, botRequestId));

      const [donor] = await tx
        .select({ name: donors.name, bloodGroup: donors.bloodGroup })
        .from(donors)
        .where(eq(donors.id, candidate.donorId));
      const [channel] = await tx
        .select({ channel: donorChannels.channel, channelUserId: donorChannels.channelUserId })
        .from(donorChannels)
        .where(eq(donorChannels.donorId, candidate.donorId));
      const [phone] = await tx
        .select({ e164: sql<string>`e164` })
        .from(sql`bot.donor_phones`)
        .where(sql`donor_id = ${candidate.donorId} AND verified`);

      await tx
        .insert(donorDemandConfirmations)
        .values({
          id: ctx.ids.next<'ConfirmationId'>(),
          demandId: request.demandId,
          donorId: candidate.donorId,
          channel: channel?.channel ?? ctx.channel.default.name,
          donorName: donor?.name ?? 'Donor',
          donorPhone: phone?.e164 ?? 'not verified',
          bloodGroup: donor?.bloodGroup ?? request.bloodGroup,
          confirmedAt: now,
          status: 'confirmed',
        })
        .onConflictDoNothing();

      if (channel) {
        messages.push({
          to: channel,
          kind: 'promoted',
          message: {
            text: MESSAGES.promoted(
              request.hospitalSnapshot as HospitalSnapshot,
              request.neededBy,
            ),
          },
          dedupeKey: `promoted:${botRequestId}:${candidate.donorId}`,
        });
      }

      promoted += 1;
    }

    if (messages.length > 0) await enqueue(tx, ctx.ids, messages, now);

    if (promoted > 0) {
      const event = createEventWriter(tx, ctx.correlationId, now);
      await event({
        event: 'waitlist.promoted',
        subjectType: 'bot_request',
        subjectId: botRequestId,
        metadata: { promoted },
      });
    }

    return { promoted };
  });
}

export { addressFor };
