/**
 * Registering a donor (§5, §8.4).
 *
 * **Minimal onboarding** — only what matching needs: name, phone, date of
 * birth, sex, blood group, weight band, district. The full four-level location,
 * the summary-and-fix-several flow and the rest of the interview are P7.
 *
 * Two rules the flow keeps:
 *
 *  1. **Progress lives in `conversation_state`, not in process memory** (§5).
 *     Somebody who starts registering on a bus and finishes an hour later must
 *     not have to start again, and a process restart must not lose them.
 *  2. **Nothing is committed to `donors` until the last step.** An abandoned
 *     interview leaves a draft row that expires, not a half-donor who can be
 *     selected into a wave without a consent record.
 *
 * The consent step stores the wording version and a snapshot of the values shown
 * (§5): "they consented to *this text*, showing *these values*, at *this time*"
 * is the only form of consent that is evidence of anything later.
 */

import { and, eq } from 'drizzle-orm';
import {
  conversationState,
  donorChannels,
  donorConsents,
  donorPhones,
  donors,
} from '@blood-connect/db/bot';
import {
  BLOOD_GROUPS,
  WEIGHT_BANDS,
  ageOn,
  effectiveWeightKg,
  nextEligibleOn,
  parseBloodGroup,
  parseCalendarDay,
  weightBandLabel,
  type CalendarDay,
  type Sex,
  type WeightBand,
} from '@blood-connect/domain';
import { err, ok, type Result } from '@blood-connect/result';

import type { BotContext } from '../context.js';
import { createEventWriter } from '../events.js';
import { MESSAGES, WORDING_VERSION } from '../messages.js';
import type { ChannelAddress, Choice, OutgoingMessage } from '../ports/channel.js';

export const ONBOARDING_STEPS = [
  'name',
  'phone',
  'dob',
  'sex',
  'blood_group',
  'weight',
  'district',
  'consent',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export type OnboardingDraft = {
  name?: string;
  phone?: string;
  dob?: string;
  sex?: Sex;
  bloodGroup?: string;
  weightBand?: WeightBand;
  districtId?: string;
  districtText?: string;
};

export type OnboardingError =
  | { readonly kind: 'Invalid'; readonly message: string }
  | { readonly kind: 'AlreadyRegistered'; readonly message: string };

/** How long a half-finished interview survives before it is dropped. */
export const DRAFT_TTL_HOURS = 24;

/* -------------------------------------------------------------------------- */
/* Prompts                                                                     */
/* -------------------------------------------------------------------------- */

const choice = (label: string, data: string): Choice => ({ label, data });

export function promptFor(
  step: OnboardingStep,
  districts: readonly { id: string; name: string }[] = [],
): OutgoingMessage {
  switch (step) {
    case 'name':
      return { text: MESSAGES.askName };
    case 'phone':
      return { text: MESSAGES.askPhone };
    case 'dob':
      return { text: MESSAGES.askDob };
    case 'sex':
      return {
        text: MESSAGES.askSex,
        choices: [
          choice('Female', 'sex:female'),
          choice('Male', 'sex:male'),
          choice('Other', 'sex:other'),
        ],
      };
    case 'blood_group':
      return {
        text: MESSAGES.askBloodGroup,
        choices: BLOOD_GROUPS.map((group) => choice(group, `group:${group}`)),
      };
    case 'weight':
      return {
        text: MESSAGES.askWeight,
        choices: WEIGHT_BANDS.map((band) => choice(weightBandLabel(band), `weight:${band}`)),
      };
    case 'district':
      return {
        text: MESSAGES.askDistrict,
        choices: districts.slice(0, 10).map((d) => choice(d.name, `district:${d.id}`)),
      };
    case 'consent':
      return {
        text: `${MESSAGES.consentTitle}\n\n${MESSAGES.consentBody}`,
        choices: [
          choice('I agree — register me', 'consent:yes'),
          choice('No, cancel', 'consent:no'),
        ],
      };
  }
}

/* -------------------------------------------------------------------------- */
/* The state machine                                                           */
/* -------------------------------------------------------------------------- */

export type OnboardingState = {
  readonly step: OnboardingStep;
  readonly draft: OnboardingDraft;
};

export async function beginOnboarding(
  ctx: BotContext,
  address: ChannelAddress,
): Promise<Result<OnboardingState, OnboardingError>> {
  const now = ctx.clock.now();

  const existing = await ctx.db
    .select({ donorId: donorChannels.donorId })
    .from(donorChannels)
    .where(
      and(
        eq(donorChannels.channel, address.channel),
        eq(donorChannels.channelUserId, address.channelUserId),
      ),
    );

  if (existing.length > 0) {
    return err({
      kind: 'AlreadyRegistered' as const,
      message: 'You are already registered.',
    });
  }

  await ctx.db
    .insert(conversationState)
    .values({
      id: ctx.ids.next<'ConversationId'>(),
      channel: address.channel,
      channelUserId: address.channelUserId,
      flow: 'onboarding',
      step: 'name',
      draft: {},
      expiresAt: new Date(now.getTime() + DRAFT_TTL_HOURS * 3_600_000),
    })
    // Starting again replaces the earlier draft rather than erroring: somebody
    // who lost their thread should be able to just start over.
    .onConflictDoUpdate({
      target: [conversationState.channel, conversationState.channelUserId],
      set: {
        flow: 'onboarding',
        step: 'name',
        draft: {},
        expiresAt: new Date(now.getTime() + DRAFT_TTL_HOURS * 3_600_000),
      },
    });

  return ok({ step: 'name', draft: {} });
}

export async function loadState(
  ctx: BotContext,
  address: ChannelAddress,
): Promise<OnboardingState | undefined> {
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
  // An expired draft is not resumed. Half-remembered answers from yesterday are
  // worse than starting again.
  if (row.expiresAt.getTime() < ctx.clock.now().getTime()) return undefined;

  return { step: row.step as OnboardingStep, draft: row.draft as OnboardingDraft };
}

export type AdvanceResult =
  | { readonly kind: 'next'; readonly state: OnboardingState }
  | {
      readonly kind: 'registered';
      readonly donorId: string;
      readonly name: string;
      readonly nextEligible: string | null;
    }
  | { readonly kind: 'abandoned' }
  /**
   * `step` is carried so the caller can re-ask the same question.
   *
   * A validation message on its own leaves somebody looking at an error with no
   * prompt, unsure whether to answer again or start over.
   */
  | { readonly kind: 'invalid'; readonly message: string; readonly step: OnboardingStep };

/**
 * Records one answer and moves to the next step.
 *
 * Validation is per-step and immediate, because a form that collects seven
 * answers and then says "the date was wrong" makes somebody redo the lot.
 */
export async function advanceOnboarding(
  ctx: BotContext,
  address: ChannelAddress,
  input: string,
): Promise<AdvanceResult> {
  const state = await loadState(ctx, address);
  // The router checks this before calling, so reaching here means the draft
  // expired between the two — start again rather than half-answer.
  if (!state) {
    const restarted = await beginOnboarding(ctx, address);
    return restarted.ok
      ? { kind: 'next', state: restarted.value }
      : { kind: 'invalid', message: restarted.error.message, step: 'name' };
  }

  const draft: OnboardingDraft = { ...state.draft };
  const value = input.trim();

  switch (state.step) {
    case 'name': {
      if (value.length < 2) return { kind: 'invalid', message: 'Please give a name.', step: state.step };
      draft.name = value.slice(0, 120);
      break;
    }
    case 'phone': {
      const digits = value.replace(/[^\d+]/g, '');
      if (digits.replace(/\D/g, '').length < 10) {
        return { kind: 'invalid', message: 'That does not look like a phone number.', step: state.step };
      }
      draft.phone = digits;
      break;
    }
    case 'dob': {
      const day = parseCalendarDay(value);
      if (!day) return { kind: 'invalid', message: 'Please give it as YYYY-MM-DD.', step: state.step };
      const age = ageOn(day, ctx.clock.today());
      const { minAge, maxAge } = ctx.config.donor;
      if (age < minAge || age > maxAge) {
        // Said plainly and without judgement — the bounds are a guideline, not
        // a statement about the person.
        return {
          kind: 'invalid',
          message:
            `Thank you for offering. Blood donation is for people aged ${minAge} to ` +
            `${maxAge}, so please do come back when you are eligible.`,
          step: state.step,
        };
      }
      draft.dob = day;
      break;
    }
    case 'sex': {
      const sex = value.replace('sex:', '');
      if (sex !== 'female' && sex !== 'male' && sex !== 'other') {
        return { kind: 'invalid', message: 'Please choose one of the options.', step: state.step };
      }
      draft.sex = sex;
      break;
    }
    case 'blood_group': {
      const group = parseBloodGroup(value.replace('group:', ''));
      if (!group) return { kind: 'invalid', message: 'Please choose a blood group.', step: state.step };
      draft.bloodGroup = group;
      break;
    }
    case 'weight': {
      const band = value.replace('weight:', '') as WeightBand;
      if (!(WEIGHT_BANDS as readonly string[]).includes(band)) {
        return { kind: 'invalid', message: 'Please choose a band.', step: state.step };
      }
      if (band === 'under_45') {
        return {
          kind: 'invalid',
          message:
            'Thank you for offering. Donating needs a weight of at least ' +
            `${String(ctx.config.donor.minWeightKg)} kg, for your own safety.`,
          step: state.step,
        };
      }
      draft.weightBand = band;
      break;
    }
    case 'district': {
      draft.districtId = value.replace('district:', '');
      draft.districtText = value.replace('district:', '');
      break;
    }
    case 'consent': {
      if (value !== 'consent:yes') {
        await ctx.db
          .delete(conversationState)
          .where(
            and(
              eq(conversationState.channel, address.channel),
              eq(conversationState.channelUserId, address.channelUserId),
            ),
          );
        return { kind: 'abandoned' };
      }
      return commitRegistration(ctx, address, draft);
    }
  }

  const index = ONBOARDING_STEPS.indexOf(state.step);
  const next = ONBOARDING_STEPS[index + 1];
  if (!next) return { kind: 'invalid', message: MESSAGES.help, step: state.step };

  await ctx.db
    .update(conversationState)
    .set({ step: next, draft })
    .where(
      and(
        eq(conversationState.channel, address.channel),
        eq(conversationState.channelUserId, address.channelUserId),
      ),
    );

  return { kind: 'next', state: { step: next, draft } };
}

/**
 * The one transaction that creates a donor (§8.4).
 *
 * Donor, channel, phone and consent commit together. A donor without a consent
 * row is somebody this system may not contact, so the two can never be written
 * separately.
 */
async function commitRegistration(
  ctx: BotContext,
  address: ChannelAddress,
  draft: OnboardingDraft,
): Promise<AdvanceResult> {
  if (
    !draft.name ||
    !draft.phone ||
    !draft.dob ||
    !draft.sex ||
    !draft.bloodGroup ||
    !draft.weightBand
  ) {
    return { kind: 'invalid', message: 'Something is missing — let us start again.', step: 'name' };
  }

  const now = ctx.clock.now();
  const donorId = ctx.ids.next<'DonorId'>();

  return ctx.db.transaction(async (tx) => {
    await tx.insert(donors).values({
      id: donorId,
      name: draft.name ?? '',
      dob: draft.dob ?? '',
      sex: draft.sex ?? 'other',
      bloodGroup: draft.bloodGroup ?? 'O+',
      // Self-declared. Verification is the centre's, on the day, and until then
      // this donor is not selected into a wave (§7.7).
      bloodGroupVerifiedAt: null,
      weightBand: draft.weightBand ?? '45_50',
      weightKg: effectiveWeightKg(draft.weightBand ?? '45_50'),
      districtId: draft.districtId ?? null,
      districtText: draft.districtText ?? null,
      lastDonatedOn: null,
      nextEligibleOn: null,
      durableFlagStatus: 'clear',
      consentCurrentAt: now,
    });

    await tx.insert(donorChannels).values({
      donorId,
      channel: address.channel,
      channelUserId: address.channelUserId,
      optedInAt: now,
    });

    await tx.insert(donorPhones).values({
      donorId,
      e164: draft.phone ?? '',
      // Unverified until the centre reaches them. The system does not claim a
      // number is confirmed because somebody typed it.
      verified: false,
    });

    await tx.insert(donorConsents).values({
      id: ctx.ids.next<'ConsentId'>(),
      donorId,
      consentedAt: now,
      wordingVersion: WORDING_VERSION,
      // The values as shown, so "they agreed to this, seeing this" is
      // answerable later without reconstructing anything (§5).
      valuesSnapshot: {
        name: draft.name,
        dob: draft.dob,
        sex: draft.sex,
        bloodGroup: draft.bloodGroup,
        weightBand: draft.weightBand,
        districtId: draft.districtId ?? null,
        text: MESSAGES.consentBody,
      },
    });

    await tx
      .delete(conversationState)
      .where(
        and(
          eq(conversationState.channel, address.channel),
          eq(conversationState.channelUserId, address.channelUserId),
        ),
      );

    const event = createEventWriter(tx, ctx.correlationId, now);
    await event({
      event: 'donor.registered',
      subjectType: 'donor',
      subjectId: donorId,
      // No name, no phone, no date of birth: the id is enough to find the row,
      // and the log outlives the incident it documents (§11.9, §12).
      metadata: { channel: address.channel, bloodGroup: draft.bloodGroup },
    });

    const eligible = nextEligibleOn(
      undefined,
      draft.sex ?? 'other',
      ctx.config.donor.intervalDays,
    );

    return {
      kind: 'registered' as const,
      donorId,
      // Carried back so the first thing they are told uses their own name.
      name: draft.name ?? '',
      nextEligible: eligible ?? null,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Controls a donor always has                                                 */
/* -------------------------------------------------------------------------- */

export async function snoozeDonor(
  ctx: BotContext,
  donorId: string,
  until: CalendarDay,
): Promise<void> {
  const now = ctx.clock.now();

  await ctx.db.transaction(async (tx) => {
    await tx.update(donors).set({ snoozeUntil: until }).where(eq(donors.id, donorId));
    const event = createEventWriter(tx, ctx.correlationId, now);
    await event({ event: 'donor.snoozed', subjectType: 'donor', subjectId: donorId });
  });
}

/**
 * Undoes a pause or an opt-out (§5).
 *
 * The counterpart to `pause` and `stop`, and it exists because those two are
 * only kind if coming back is as easy as leaving. Clearing `opted_out_at` also
 * restores consent currency, which is what the wave query actually reads.
 */
export async function resumeDonor(ctx: BotContext, donorId: string): Promise<void> {
  const now = ctx.clock.now();

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(donors)
      .set({ snoozeUntil: null, optedOutAt: null, consentCurrentAt: now })
      .where(eq(donors.id, donorId));
    const event = createEventWriter(tx, ctx.correlationId, now);
    await event({ event: 'donor.resumed', subjectType: 'donor', subjectId: donorId });
  });
}

export async function optOutDonor(ctx: BotContext, donorId: string): Promise<void> {
  const now = ctx.clock.now();

  await ctx.db.transaction(async (tx) => {
    await tx.update(donors).set({ optedOutAt: now }).where(eq(donors.id, donorId));
    const event = createEventWriter(tx, ctx.correlationId, now);
    await event({ event: 'donor.opted_out', subjectType: 'donor', subjectId: donorId });
  });
}

/**
 * Deletion, said plainly before it happens (§5).
 *
 * The donor row is de-identified rather than removed, and confirmations keep
 * their donor id with the name and phone blanked — a donation record the blood
 * centre is required to keep must survive, and it must survive without the
 * person's name attached. Deleting the row outright would break that record and
 * the traceability §4 requires.
 */
export async function deleteDonorData(ctx: BotContext, donorId: string): Promise<void> {
  const now = ctx.clock.now();

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(donors)
      .set({
        name: 'Deleted donor',
        districtText: null,
        cityText: null,
        townText: null,
        localityText: null,
        deletedAt: now,
        optedOutAt: now,
        consentCurrentAt: null,
      })
      .where(eq(donors.id, donorId));

    await tx.delete(donorPhones).where(eq(donorPhones.donorId, donorId));
    await tx.delete(donorChannels).where(eq(donorChannels.donorId, donorId));

    const event = createEventWriter(tx, ctx.correlationId, now);
    await event({ event: 'donor.deleted', subjectType: 'donor', subjectId: donorId });
  });
}

/** The donor behind a channel identity, if there is one. */
export async function findDonorByAddress(
  ctx: BotContext,
  address: ChannelAddress,
): Promise<{ donorId: string; name: string } | undefined> {
  const [row] = await ctx.db
    .select({ donorId: donors.id, name: donors.name })
    .from(donorChannels)
    .innerJoin(donors, eq(donors.id, donorChannels.donorId))
    .where(
      and(
        eq(donorChannels.channel, address.channel),
        eq(donorChannels.channelUserId, address.channelUserId),
      ),
    );

  return row;
}
