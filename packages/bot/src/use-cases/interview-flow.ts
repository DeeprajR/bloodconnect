/**
 * What happens when a donor answers (§5, §8.4).
 *
 * `interview.ts` says what the screens are; this says how one moves between
 * them. The split matters because the *same* screens serve three entry points,
 * signup, the fix-several checklist and the profile editor, and the navigation
 * is the only thing that differs between them.
 *
 * The rule that shapes all of it: **nothing is committed until the final
 * acknowledgement**. Edits accumulate against the in-progress draft, so
 * abandoning a fix leaves the donor exactly where they were (§5).
 */

import { and, eq } from 'drizzle-orm';
import {
  conversationState,
  donorChannels,
  donorConsents,
  donorPhones,
  donorScreeningAnswers,
  donors,
} from '@blood-connect/db/bot';
import {
  WEIGHT_BANDS,
  ageOn,
  nextEligibleOn,
  qualifyDonor,
  weightKgFromBand,
  parseBloodGroup,
  parseCalendarDay,
  subtractDays,
  type CalendarDay,
  type WeightBand,
} from '@blood-connect/domain';

import type { BotContext } from '../context.js';
import { createEventWriter } from '../events.js';
import { MESSAGES, WORDING_VERSION } from '../messages.js';
import {
  durableAnswersFrom,
  durableQuestionsFor,
  isPermanentDeferral,
} from '../screening.js';
import type { ChannelAddress } from '../ports/channel.js';
import {
  DRAFT_TTL_HOURS,
  INTERVIEW_STEPS,
  isInterviewStep,
  stepAtRow,
  summaryRows,
  type FlowStep,
  type InterviewDraft,
  type InterviewState,
  type InterviewStep,
} from './interview.js';
import { hasChildren, levelBelow, nodeById, searchChildren } from './location.js';

/* -------------------------------------------------------------------------- */
/* Loading and saving                                                          */
/* -------------------------------------------------------------------------- */

export async function beginInterview(
  ctx: BotContext,
  address: ChannelAddress,
  options: { readonly flow?: 'onboarding' | 'profile'; readonly donorId?: string; readonly draft?: InterviewDraft; readonly step?: FlowStep } = {},
): Promise<InterviewState> {
  const now = ctx.clock.now();
  const flow = options.flow ?? 'onboarding';
  const step: FlowStep = options.step ?? (flow === 'profile' ? 'summary' : 'phone');
  const draft = options.draft ?? {};

  const row = {
    flow,
    step,
    draft: { ...draft, donorId: options.donorId },
    expiresAt: new Date(now.getTime() + DRAFT_TTL_HOURS * 3_600_000),
  };

  await ctx.db
    .insert(conversationState)
    .values({
      id: ctx.ids.next<'ConversationId'>(),
      channel: address.channel,
      channelUserId: address.channelUserId,
      ...row,
    })
    // Starting again replaces the earlier draft rather than erroring: somebody
    // who lost their thread should be able to simply start over.
    .onConflictDoUpdate({
      target: [conversationState.channel, conversationState.channelUserId],
      set: row,
    });

  return { step, draft, flow, donorId: options.donorId };
}

export async function loadInterview(
  ctx: BotContext,
  address: ChannelAddress,
): Promise<InterviewState | undefined> {
  const [row] = await ctx.db
    .select()
    .from(conversationState)
    .where(
      and(
        eq(conversationState.channel, address.channel),
        eq(conversationState.channelUserId, address.channelUserId),
      ),
    );

  if (!row) return undefined;
  /**
   * An expired draft is not resumed, but it is also not silently discarded
   * mid-sentence: the router starts a fresh interview. Half-remembered answers
   * from three days ago are worse than starting again.
   */
  if (row.expiresAt.getTime() < ctx.clock.now().getTime()) return undefined;

  const stored = row.draft as InterviewDraft & { donorId?: string };
  return {
    step: row.step as FlowStep,
    draft: stored,
    flow: row.flow === 'profile' ? 'profile' : 'onboarding',
    donorId: stored.donorId,
  };
}

async function save(
  ctx: BotContext,
  address: ChannelAddress,
  state: InterviewState,
): Promise<void> {
  const now = ctx.clock.now();
  await ctx.db
    .update(conversationState)
    .set({
      flow: state.flow,
      step: state.step,
      draft: { ...state.draft, donorId: state.donorId },
      // Every answer buys another 48 hours. Somebody working through the
      // interview slowly must not time out halfway.
      expiresAt: new Date(now.getTime() + DRAFT_TTL_HOURS * 3_600_000),
    })
    .where(
      and(
        eq(conversationState.channel, address.channel),
        eq(conversationState.channelUserId, address.channelUserId),
      ),
    );
}

export async function clearInterview(
  ctx: BotContext,
  address: ChannelAddress,
): Promise<void> {
  await ctx.db
    .delete(conversationState)
    .where(
      and(
        eq(conversationState.channel, address.channel),
        eq(conversationState.channelUserId, address.channelUserId),
      ),
    );
}

/* -------------------------------------------------------------------------- */
/* Navigation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Where to go once a step is answered.
 *
 * The fix queue takes precedence over the natural order, which is what makes
 * "walk only the ticked fields, in summary order, and come back **once**" (§5)
 * fall out of one rule rather than a special case per entry point.
 */
function afterStep(draft: InterviewDraft, step: InterviewStep): { step: FlowStep; draft: InterviewDraft } {
  const fixing = draft.fixing ?? [];

  if (fixing.length > 0) {
    const changed = [...new Set([...(draft.changed ?? []), step])];
    const [next, ...rest] = fixing;
    // The step just answered is the head of the queue in the normal case; if it
    // is not, the donor jumped somewhere else and the queue is left alone.
    const remaining = next === step ? rest : fixing;

    if (remaining.length === 0) {
      return { step: 'summary', draft: { ...draft, fixing: [], changed } };
    }
    return { step: remaining[0]!, draft: { ...draft, fixing: remaining, changed } };
  }

  const index = INTERVIEW_STEPS.indexOf(step);
  const next = INTERVIEW_STEPS[index + 1];
  return { step: next ?? 'summary', draft };
}

/** Starting a step fresh, clearing whatever sub-cursor it uses. */
function enterStep(draft: InterviewDraft, step: FlowStep): InterviewDraft {
  if (step === 'screening') return { ...draft, screeningIndex: 0 };
  if (step === 'location') {
    /**
     * A location edit restarts at the district and walks down (§5).
     *
     * "Changing the district resets the levels beneath it, because a town in
     * the old district is meaningless in the new one." Clearing all four and
     * continuing down the chain is that rule, rather than four special cases.
     */
    return {
      ...draft,
      locationLevel: 'district',
      districtId: undefined,
      cityId: undefined,
      townId: undefined,
      localityId: undefined,
      locationSearch: undefined,
    };
  }
  if (step === 'dob') return { ...draft, dob: undefined };
  return draft;
}

/* -------------------------------------------------------------------------- */
/* Answering                                                                   */
/* -------------------------------------------------------------------------- */

export type AnswerResult =
  | { readonly kind: 'next'; readonly state: InterviewState }
  /** The same step again, with a reason. */
  | { readonly kind: 'invalid'; readonly message: string; readonly state: InterviewState }
  | {
      readonly kind: 'registered';
      readonly donorId: string;
      readonly name: string;
      readonly nextEligible: string | null;
      readonly matchable: MatchableCheck;
      readonly returnToRequest?: string | undefined;
    }
  | { readonly kind: 'saved'; readonly donorId: string }
  /** Registered and dormant: "not now" is not "delete me" (§5). */
  | { readonly kind: 'declined'; readonly donorId: string; readonly name: string };

/**
 * Why a registered donor might still not be matched (§5).
 *
 * "Told plainly which it is, what would change it, and that they stay on the
 * list. This is an ending, not a rejection." So the reason is carried out of
 * the commit rather than being recomputed by the caller from four fields.
 */
export type MatchableCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'group_unknown' | 'under_weight' | 'flagged' | 'interval'; readonly until?: string | undefined };

export async function answerInterview(
  ctx: BotContext,
  address: ChannelAddress,
  input: string,
): Promise<AnswerResult> {
  const state = await loadInterview(ctx, address);
  if (!state) {
    const fresh = await beginInterview(ctx, address);
    return { kind: 'next', state: fresh };
  }

  const value = input.trim();

  /* --- the two screens ------------------------------------------------ */
  if (state.step === 'summary') return handleSummary(ctx, address, state, value);
  if (state.step === 'fix_choose') return handleChecklist(ctx, address, state, value);

  return handleAnswer(ctx, address, state, value);
}

/** A shared contact, which is the only path that yields a verified number. */
export async function answerContact(
  ctx: BotContext,
  address: ChannelAddress,
  phone: string,
): Promise<AnswerResult> {
  const state = await loadInterview(ctx, address);
  if (!state) return { kind: 'next', state: await beginInterview(ctx, address) };
  if (state.step !== 'phone') {
    // A stray tap on a keyboard left over from earlier. Re-ask where they are
    // rather than storing a number against the wrong question.
    return { kind: 'next', state };
  }

  const draft = { ...state.draft, phone: normalisePhone(phone), phoneVerified: true };
  const moved = afterStep(draft, 'phone');
  const next: InterviewState = {
    ...state,
    step: moved.step,
    draft: enterStep(moved.draft, moved.step),
  };
  await save(ctx, address, next);
  return { kind: 'next', state: next };
}

const normalisePhone = (value: string): string => {
  const cleaned = value.replace(/[^\d+]/g, '');
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
};

/* -------------------------------------------------------------------------- */
/* One answered step                                                           */
/* -------------------------------------------------------------------------- */

async function handleAnswer(
  ctx: BotContext,
  address: ChannelAddress,
  state: InterviewState,
  value: string,
): Promise<AnswerResult> {
  const step = state.step as InterviewStep;
  let draft: InterviewDraft = { ...state.draft };
  /** Set when a step is answered in parts. A date, or a location level. */
  let stayOnStep = false;

  switch (step) {
    case 'phone': {
      const digits = value.replace(/\D/g, '');
      if (digits.length < 10) {
        return invalid(state, 'That does not look like a phone number. Ten digits, please.');
      }
      draft.phone = normalisePhone(value);
      // Typed, not shared: the platform has not vouched for it (§5).
      draft.phoneVerified = false;
      break;
    }

    case 'name': {
      if (value.length < 2) return invalid(state, 'Please tell me your name.');
      draft.name = value.slice(0, 120);
      break;
    }

    case 'dob': {
      const typed = parseCalendarDay(value);
      if (typed) {
        draft.dob = typed;
      } else if (value.startsWith('dob:y:')) {
        draft.dob = value.slice(6);
        stayOnStep = true;
      } else if (value.startsWith('dob:m:')) {
        draft.dob = `${draft.dob ?? ''}-${value.slice(6)}`;
        stayOnStep = true;
      } else if (value.startsWith('dob:d:')) {
        draft.dob = `${draft.dob ?? ''}-${value.slice(6)}`;
      } else {
        return invalid(state, 'Please pick from the buttons, or type the date as YYYY-MM-DD.');
      }

      if (!stayOnStep) {
        const day = parseCalendarDay(draft.dob ?? '');
        if (!day) {
          draft.dob = undefined;
          return invalid(state, 'That is not a date I recognise. Let us try again.');
        }
        const age = ageOn(day, ctx.clock.today());
        const { minAge, maxAge } = ctx.config.donor;
        if (age < minAge || age > maxAge) {
          draft.dob = undefined;
          await save(ctx, address, { ...state, draft });
          // Plainly and without judgement: the bounds are a guideline, not a
          // statement about the person (§2.7).
          return invalid(
            { ...state, draft },
            `Thank you for offering. Blood donation is for people aged ${String(minAge)} to ` +
              `${String(maxAge)}, so please do come back when you are eligible.`,
          );
        }
        draft.dob = day;
      }
      break;
    }

    case 'sex': {
      const sex = value.replace('sex:', '');
      if (sex !== 'female' && sex !== 'male' && sex !== 'other') {
        return invalid(state, 'Please choose one of the options.');
      }
      draft.sex = sex;
      break;
    }

    case 'blood_group': {
      const raw = value.replace('group:', '');
      if (raw === 'unknown') {
        // Not a gap to be filled with a guess: staff type the donor at their
        // first donation, and until then they are simply not matched (§5).
        draft.groupUnknown = true;
        draft.bloodGroup = undefined;
        break;
      }
      const group = parseBloodGroup(raw);
      if (!group) return invalid(state, 'Please choose a blood group, or “I don’t know”.');
      draft.bloodGroup = group;
      draft.groupUnknown = false;
      break;
    }

    case 'weight': {
      const band = value.replace('weight:', '') as WeightBand;
      if (!(WEIGHT_BANDS as readonly string[]).includes(band)) {
        return invalid(state, 'Please choose a band.');
      }
      draft.weightBand = band;
      break;
    }

    case 'screening': {
      const answer = value.replace('durable:', '');
      if (answer !== 'yes' && answer !== 'no') {
        return invalid(state, 'Please answer yes or no.');
      }

      const questions = durableQuestionsFor(draft.sex ?? 'other');
      const index = draft.screeningIndex ?? 0;
      const question = questions[index];
      if (!question) break;

      draft.screening = { ...(draft.screening ?? {}), [question.key]: answer };
      draft.screeningIndex = index + 1;
      // The whole short set is asked before moving on; §5 re-asks all of it on a
      // fix, because which question was wrong is exactly what the donor cannot
      // see from the summary.
      stayOnStep = draft.screeningIndex < questions.length;
      break;
    }

    case 'location': {
      const outcome = await handleLocation(ctx, draft, value);
      if (outcome.kind === 'invalid') return invalid(state, outcome.message);
      draft = outcome.draft;
      stayOnStep = outcome.stay;
      break;
    }

    case 'last_donation': {
      const typed = parseCalendarDay(value);
      if (typed) {
        if (typed > ctx.clock.today()) {
          return invalid(state, 'That date is in the future.');
        }
        draft.lastDonatedOn = typed;
        draft.neverDonated = false;
        break;
      }

      const bucket = value.replace('donated:', '');
      const today = ctx.clock.today();
      switch (bucket) {
        case 'never':
          draft.neverDonated = true;
          draft.lastDonatedOn = undefined;
          break;
        /**
         * The most recent day in each range, deliberately.
         *
         * Assuming somebody donated **more** recently than they did only ever
         * delays their next donation, which is the safe direction. The same
         * choice §12 makes for the unspecified interval. A donor who knows the
         * exact date can type it, and the prompt says so.
         */
        case 'recent':
          draft.lastDonatedOn = today;
          draft.neverDonated = false;
          break;
        case '3to6':
          draft.lastDonatedOn = subtractDays(today, 90);
          draft.neverDonated = false;
          break;
        case 'older':
          draft.lastDonatedOn = subtractDays(today, 180);
          draft.neverDonated = false;
          break;
        default:
          return invalid(state, 'Please choose one, or type the date as YYYY-MM-DD.');
      }
      break;
    }
  }

  if (stayOnStep) {
    const next: InterviewState = { ...state, draft };
    await save(ctx, address, next);
    return { kind: 'next', state: next };
  }

  const moved = afterStep(draft, step);
  const next: InterviewState = {
    ...state,
    step: moved.step,
    draft: moved.step === 'summary' ? moved.draft : enterStep(moved.draft, moved.step),
  };
  await save(ctx, address, next);
  return { kind: 'next', state: next };
}

const invalid = (state: InterviewState, message: string): AnswerResult => ({
  kind: 'invalid',
  message,
  state,
});

/* -------------------------------------------------------------------------- */
/* The location chain                                                          */
/* -------------------------------------------------------------------------- */

type LocationOutcome =
  | { readonly kind: 'ok'; readonly draft: InterviewDraft; readonly stay: boolean }
  | { readonly kind: 'invalid'; readonly message: string };

async function handleLocation(
  ctx: BotContext,
  current: InterviewDraft,
  value: string,
): Promise<LocationOutcome> {
  const draft: InterviewDraft = { ...current };
  const level = draft.locationLevel ?? 'district';

  /* --- a tap on a matched place --------------------------------------- */
  if (value.startsWith('loc:')) {
    const [, chosenLevel, id] = value.split(':');
    if (!chosenLevel || !id) return { kind: 'invalid', message: 'Please pick a place.' };

    const node = await nodeById(ctx, id);
    if (!node) {
      // An id that no longer exists. A stale card after a dataset update.
      return { kind: 'invalid', message: 'That place is not in the list any more.' };
    }

    if (chosenLevel === 'district') draft.districtId = id;
    if (chosenLevel === 'city') draft.cityId = id;
    if (chosenLevel === 'town') draft.townId = id;
    if (chosenLevel === 'locality') draft.localityId = id;
    draft.locationSearch = undefined;

    const below = levelBelow(chosenLevel as never);
    /**
     * The chain ends where the dataset ends.
     *
     * Several Kozhikode towns have no localities under them, and asking "which
     * locality?" with an empty list is a dead end a donor cannot get out of.
     */
    if (below === undefined || !(await hasChildren(ctx, id))) {
      return { kind: 'ok', draft, stay: false };
    }

    draft.locationLevel = below;
    return { kind: 'ok', draft, stay: true };
  }

  /* --- typed, at a level that offers a type-ahead ---------------------- */
  if (level === 'district') {
    return { kind: 'invalid', message: 'Please pick a district from the buttons.' };
  }

  const parentId =
    level === 'city' ? draft.districtId : level === 'town' ? draft.cityId : draft.townId;
  if (!parentId) {
    draft.locationLevel = 'district';
    return { kind: 'ok', draft, stay: true };
  }

  const matches = await searchChildren(ctx, parentId, value);
  if (matches.length === 0) {
    /**
     * Free text is a last resort and lands in a review queue rather than
     * silently creating a place (§5). The donor's own wording is kept beside
     * whatever the reviewer matches it to.
     */
    draft.locationText = value.slice(0, 120);
    draft.locationSearch = undefined;
    return { kind: 'ok', draft, stay: false };
  }

  // Matches found: show them and stay here until one is tapped.
  draft.locationSearch = value.slice(0, 60);
  return { kind: 'ok', draft, stay: true };
}

/* -------------------------------------------------------------------------- */
/* The summary screen                                                          */
/* -------------------------------------------------------------------------- */

async function handleSummary(
  ctx: BotContext,
  address: ChannelAddress,
  state: InterviewState,
  value: string,
): Promise<AnswerResult> {
  if (value === 'sum:fix') {
    const next: InterviewState = { ...state, step: 'fix_choose', draft: { ...state.draft, ticked: [] } };
    await save(ctx, address, next);
    return { kind: 'next', state: next };
  }

  if (value === 'sum:confirm') return commit(ctx, address, state, true);

  /**
   * "Not now". Kept, dormant, reversible (§5, §8).
   *
   * The profile is written exactly as it would have been, and the one thing
   * missing is the acknowledgement: no consent row, and `consent_current_at`
   * left null, which is what §7.7's wave query reads. So they are registered and
   * never contacted until they say so.
   */
  if (value === 'sum:decline') return commit(ctx, address, state, false);

  /* --- a row number, typed or tapped: jump straight to that field ------ */
  const row = Number(value.replace('sum:row:', ''));
  const step = Number.isInteger(row) ? stepAtRow(row) : undefined;
  if (step) {
    const draft = enterStep({ ...state.draft, fixing: [step] }, step);
    const next: InterviewState = { ...state, step, draft };
    await save(ctx, address, next);
    return { kind: 'next', state: next };
  }

  return invalid(state, MESSAGES.summaryHelp);
}

async function handleChecklist(
  ctx: BotContext,
  address: ChannelAddress,
  state: InterviewState,
  value: string,
): Promise<AnswerResult> {
  const ticked = new Set(state.draft.ticked ?? []);

  if (value.startsWith('fix:toggle:')) {
    const step = value.replace('fix:toggle:', '');
    if (!isInterviewStep(step)) return invalid(state, 'That is not one of the rows.');
    // The list stays open and the ticks accumulate (§5).
    if (ticked.has(step)) ticked.delete(step);
    else ticked.add(step);

    const next: InterviewState = { ...state, draft: { ...state.draft, ticked: [...ticked] } };
    await save(ctx, address, next);
    return { kind: 'next', state: next };
  }

  if (value === 'fix:cancel') {
    // The summary, unchanged. An escape hatch that costs nothing (§5).
    const next: InterviewState = { ...state, step: 'summary', draft: { ...state.draft, ticked: [] } };
    await save(ctx, address, next);
    return { kind: 'next', state: next };
  }

  if (value === 'fix:go') {
    if (ticked.size === 0) {
      const next: InterviewState = { ...state, step: 'summary', draft: { ...state.draft, ticked: [] } };
      await save(ctx, address, next);
      return { kind: 'next', state: next };
    }

    // In the order they appear on the summary, whatever order they were tapped.
    const queue = INTERVIEW_STEPS.filter((step) => ticked.has(step));
    const first = queue[0]!;
    const draft = enterStep({ ...state.draft, fixing: queue, ticked: [], changed: [] }, first);
    const next: InterviewState = { ...state, step: first, draft };
    await save(ctx, address, next);
    return { kind: 'next', state: next };
  }

  /* --- a typed list, for a channel that cannot toggle (§2.11) ---------- */
  const rows = value
    .split(/[\s,]+/)
    .map((part) => Number(part))
    .filter((n) => Number.isInteger(n));
  const steps = rows
    .map((n) => stepAtRow(n))
    .filter((step): step is InterviewStep => step !== undefined);

  if (steps.length > 0) {
    const queue = INTERVIEW_STEPS.filter((step) => steps.includes(step));
    const first = queue[0]!;
    const draft = enterStep({ ...state.draft, fixing: queue, ticked: [], changed: [] }, first);
    const next: InterviewState = { ...state, step: first, draft };
    await save(ctx, address, next);
    return { kind: 'next', state: next };
  }

  return invalid(state, MESSAGES.fixHelp);
}

/* -------------------------------------------------------------------------- */
/* Committing                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The acknowledgement, and the only write to `donors` in the whole interview.
 *
 * Consent is recorded as §5 requires it: the timestamp, the version of the
 * wording shown, and a **snapshot of the summarised values** the donor was
 * agreeing to. "They consented" is not evidence; "they consented to this text,
 * showing these values, at this time" is.
 */
async function commit(
  ctx: BotContext,
  address: ChannelAddress,
  state: InterviewState,
  acknowledged: boolean,
): Promise<AnswerResult> {
  const { draft } = state;
  const now = ctx.clock.now();

  const missing = INTERVIEW_STEPS.filter((step) => !isAnswered(draft, step));
  if (missing.length > 0) {
    const first = missing[0]!;
    const next: InterviewState = { ...state, step: first, draft: enterStep({ ...draft, fixing: missing }, first) };
    await save(ctx, address, next);
    return { kind: 'next', state: next };
  }

  const dob = parseCalendarDay(draft.dob ?? '');
  const sex = draft.sex ?? 'other';
  if (!dob) return invalid(state, 'Something is missing from your date of birth.');

  const lastDonated = draft.neverDonated === true ? null : parseCalendarDay(draft.lastDonatedOn ?? '');
  // `nextEligibleOn` returns undefined for an interval it cannot compute; the
  // column and every reader below want null.
  const eligible =
    (lastDonated ? nextEligibleOn(lastDonated, sex, ctx.config.donor.intervalDays) : null) ??
    null;

  const flagged = durableAnswersFrom(draft.screening ?? {});
  const permanent = flagged.some((entry) => isPermanentDeferral(entry.questionKey));

  const weightBandForQualification = draft.weightBand ?? '50_60';

  /**
   * Their qualification, decided here and written with the profile (§5).
   *
   * This is the moment every input the judgement rests on is present and
   * settled, so it is the moment to decide it. Doing it in the same transaction
   * as the profile means the two cannot disagree: there is no window in which a
   * donor row exists with a qualification computed from different answers.
   *
   * It is recomputed on a profile edit for the same reason, because a corrected
   * date of birth or weight band is exactly the kind of change that should move
   * somebody into or out of the pool.
   */
  const qualification = qualifyDonor(
    {
      dob,
      weightKg: weightKgFromBand(weightBandForQualification),
      flagged: flagged.length > 0,
      // "I don't know" is a blank, not an answer, and the column it lands in
      // cannot hold a blank. Recruiting on the default would be matching on a
      // group the system chose.
      groupUnknown: draft.groupUnknown === true || draft.bloodGroup === undefined,
    },
    ctx.clock.today(),
    {
      minAge: ctx.config.donor.minAge,
      maxAge: ctx.config.donor.maxAge,
      minWeightKg: ctx.config.donor.minWeightKg,
    },
  );

  const values = await summaryRows(ctx, draft);
  const snapshot = Object.fromEntries(
    values.map((row) => [row.step, row.detail ? row.detail.join(' · ') : row.value]),
  );

  const donorId = state.donorId ?? ctx.ids.next<'DonorId'>();
  const weightBand = draft.weightBand ?? '50_60';

  await ctx.db.transaction(async (tx) => {
    const profile = {
      name: draft.name ?? '',
      dob,
      sex,
      bloodGroup: draft.bloodGroup ?? 'O+',
      /**
       * Left unset, and no longer a gate.
       *
       * The centre stamps it when it types the group off a unit this donor
       * gave, and if the typed group disagrees with what they believed, the
       * typed one wins. Recruitment does not wait for it: it runs on the group
       * the donor gave us (§7.7).
       */
      bloodGroupVerifiedAt: null,
      weightBand,
      /**
       * The band's lower bound, which is the conservative reading (§5).
       *
       * This used to pass the configured **minimum** as the second argument.
       * That argument is the donor's own exact figure, so every registration
       * stored precisely the threshold weight, and somebody who tapped
       * "Under 45" was written down as weighing exactly 45 and passed the
       * check that exists to stop them being asked. The interview collects no
       * exact figure, so there is nothing to pass: the band is the answer.
       */
      weightKg: weightKgFromBand(weightBand),
      districtId: draft.districtId ?? null,
      cityId: draft.cityId ?? null,
      townId: draft.townId ?? null,
      localityId: draft.localityId ?? null,
      districtText: draft.locationText ?? null,
      lastDonatedOn: lastDonated,
      nextEligibleOn: eligible,
      durableFlagStatus: flagged.length > 0 ? 'flagged' : 'clear',
      qualificationStatus: qualification.status,
      qualificationReason: qualification.reason,
      qualifiedAt: now,
      /**
       * The acknowledgement is what makes every later message lawful (§5).
       *
       * Null when they said "not now": the row exists, and §7.7 recruits nobody
       * whose consent is not current, so a dormant registration is dormant by
       * the same rule that governs everybody else rather than by a second flag
       * somewhere that could disagree with it.
       */
      consentCurrentAt: acknowledged ? now : null,
    };

    if (state.donorId) {
      await tx.update(donors).set(profile).where(eq(donors.id, state.donorId));
    } else {
      await tx.insert(donors).values({ id: donorId, ...profile });
      await tx
        .insert(donorChannels)
        .values({ donorId, channel: address.channel, channelUserId: address.channelUserId })
        .onConflictDoNothing();
    }

    if (draft.phone) {
      await tx
        .insert(donorPhones)
        .values({
          donorId,
          e164: draft.phone,
          // Only a number the platform vouched for is verified (§5, step 1).
          verified: draft.phoneVerified === true,
          verifiedAt: draft.phoneVerified === true ? now : null,
        })
        .onConflictDoNothing();
    }

    /**
     * Durable answers, and only the flagging ones.
     *
     * Recording "no, I have never had hepatitis" would be storing a health
     * datum that changes nothing (§2.10). The absence of a row is the answer.
     */
    if (flagged.length > 0) {
      await tx
        .insert(donorScreeningAnswers)
        .values(
          flagged.map((entry) => ({
            donorId,
            questionKey: entry.questionKey,
            answer: entry.answer,
            answeredAt: now,
          })),
        )
        .onConflictDoNothing();
    }

    /**
     * No consent row when they declined, because they did not consent.
     *
     * Writing one with a "declined" flag on it would put a record of consent in
     * the table that is the evidence of consent, and the first person to query
     * it for "who agreed" would get the wrong answer.
     */
    if (acknowledged) {
      await tx.insert(donorConsents).values({
        id: ctx.ids.next<'ConsentId'>(),
        donorId,
        consentedAt: now,
        wordingVersion: WORDING_VERSION,
        valuesSnapshot: snapshot,
      });
    }

    const event = createEventWriter(tx, ctx.correlationId, now);
    await event({
      event: state.donorId
        ? 'donor.profile_updated'
        : acknowledged
          ? 'donor.registered'
          : 'donor.registered_dormant',
      subjectType: 'donor',
      subjectId: donorId,
      // Counts and flags only. No name, no number, no health datum (§11.9).
      metadata: {
        flagged: flagged.length > 0,
        permanent,
        groupKnown: draft.groupUnknown !== true,
        phoneVerified: draft.phoneVerified === true,
        // The decision, so "how many of the people who signed up can we ask?"
        // is answerable from the log rather than only from a live query.
        qualification: qualification.status,
      },
    });
  });

  await clearInterview(ctx, address);

  if (state.donorId) return { kind: 'saved', donorId };
  if (!acknowledged) return { kind: 'declined', donorId, name: draft.name ?? '' };

  return {
    kind: 'registered',
    donorId,
    name: draft.name ?? '',
    nextEligible: eligible,
    matchable: matchableCheck(draft, flagged.length > 0, eligible, ctx.clock.today()),
    returnToRequest: draft.returnToRequest,
  };
}

const isAnswered = (draft: InterviewDraft, step: InterviewStep): boolean => {
  switch (step) {
    case 'phone':
      return typeof draft.phone === 'string' && draft.phone.length > 0;
    case 'name':
      return typeof draft.name === 'string' && draft.name.length > 0;
    case 'dob':
      return parseCalendarDay(draft.dob ?? '') !== undefined;
    case 'sex':
      return draft.sex !== undefined;
    case 'blood_group':
      return draft.bloodGroup !== undefined || draft.groupUnknown === true;
    case 'weight':
      return draft.weightBand !== undefined;
    case 'screening': {
      const questions = durableQuestionsFor(draft.sex ?? 'other');
      return questions.every((question) => draft.screening?.[question.key] !== undefined);
    }
    case 'location':
      return draft.districtId !== undefined || draft.locationText !== undefined;
    case 'last_donation':
      return draft.neverDonated === true || draft.lastDonatedOn !== undefined;
  }
};

/**
 * Which of the four things stops this donor being matched, if any (§5).
 *
 * "Told plainly which it is, what would change it, and that they stay on the
 * list." Ordered by what the donor can act on: a group they can have typed at a
 * donation comes before an interval they can only wait out.
 */
function matchableCheck(
  draft: InterviewDraft,
  flagged: boolean,
  eligible: string | null,
  today: CalendarDay,
): MatchableCheck {
  if (draft.groupUnknown === true || draft.bloodGroup === undefined) {
    return { ok: false, reason: 'group_unknown' };
  }
  if (draft.weightBand === 'under_45') return { ok: false, reason: 'under_weight' };
  if (flagged) return { ok: false, reason: 'flagged' };
  if (eligible !== null && eligible > today) {
    return { ok: false, reason: 'interval', until: eligible };
  }
  return { ok: true };
}
