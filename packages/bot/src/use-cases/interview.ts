/**
 * The registration interview (§5, §8.4).
 *
 * Ten steps, in the order §5 sets out, and three properties hold throughout:
 *
 *  1. **Progress lives in `conversation_state`, never in process memory.**
 *     Somebody who starts on a bus and finishes an hour later must not have to
 *     start again, and a restart must not strand them mid-interview.
 *  2. **Nothing is committed to `donors` until the final acknowledgement.** An
 *     abandoned interview leaves a draft that expires, not a half-donor who can
 *     be selected into a wave with no consent record behind them.
 *  3. **The re-ask is the original question, unchanged.** There is no second,
 *     lesser edit interface. The same prompts serve signup, the fix flow and
 *     the profile editor, which is why they are one function and not three.
 *
 * The summary is the pivot: everything the donor said, played back, each row
 * numbered and correctable, and a single confirmation covering both *"these
 * details are correct"* and *"message me when someone near me needs my group"*.
 * §5 is firm that those two are inseparable in practice. Consent to be
 * contacted about a blood group is meaningless if the blood group is wrong.
 */

import {
  BLOOD_GROUPS,
  WEIGHT_BANDS,
  ageOn,
  bloodGroupLabel,
  nextEligibleOn,
  parseCalendarDay,
  weightBandLabel,
  type BloodGroup,
  type CalendarDay,
  type Sex,
  type WeightBand,
} from '@blood-connect/domain';

import type { BotContext } from '../context.js';
import { MESSAGES } from '../messages.js';
import { durableQuestionsFor, durableSummaryLines } from '../screening.js';
import type { Choice, OutgoingMessage } from '../ports/channel.js';
import {
  describeLocation,
  listChildren,
  listDistricts,
  searchChildren,
  type LocationLevel,
} from './location.js';

/* -------------------------------------------------------------------------- */
/* The steps                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The nine answerable steps, in the order they are asked **and** the order they
 * appear on the summary. One list, because the fix flow walks ticked fields "in
 * the order they appear in the summary" (§5) and a second ordering would drift
 * from this one within a month.
 */
export const INTERVIEW_STEPS = [
  'phone',
  'name',
  'dob',
  'sex',
  'blood_group',
  'weight',
  'screening',
  'location',
  'last_donation',
] as const;
export type InterviewStep = (typeof INTERVIEW_STEPS)[number];

/** Every state the interview can be sitting in, including the two screens. */
export type FlowStep = InterviewStep | 'summary' | 'fix_choose';

export const isInterviewStep = (value: string): value is InterviewStep =>
  (INTERVIEW_STEPS as readonly string[]).includes(value);

/** The row number a donor types or taps to jump straight to a field (§5). */
export const rowNumberOf = (step: InterviewStep): number =>
  INTERVIEW_STEPS.indexOf(step) + 1;

export const stepAtRow = (row: number): InterviewStep | undefined =>
  INTERVIEW_STEPS[row - 1];

export const STEP_LABELS: Readonly<Record<InterviewStep, string>> = {
  phone: 'Phone',
  name: 'Name',
  dob: 'Date of birth',
  sex: 'Sex',
  blood_group: 'Blood group',
  weight: 'Weight',
  screening: 'Screening answers',
  location: 'Where you live',
  last_donation: 'Last donated',
};

/* -------------------------------------------------------------------------- */
/* The draft                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Every optional field admits `undefined` explicitly.
 *
 * `exactOptionalPropertyTypes` otherwise rejects `{ ...draft, dob: undefined }`,
 * and clearing a field by spreading is exactly how the fix flow resets a step:
 * `delete` on a spread copy would be the alternative, and it reads worse.
 */
export type InterviewDraft = {
  phone?: string | undefined;
  /** True only when the platform vouched for the number (§5, step 1). */
  phoneVerified?: boolean | undefined;
  name?: string | undefined;
  dob?: string | undefined;
  sex?: Sex | undefined;
  /** Absent when the donor answered "I don't know". Staff type them later. */
  bloodGroup?: string | undefined;
  groupUnknown?: boolean | undefined;
  weightBand?: WeightBand | undefined;

  /** Durable answers, by question key. Visit answers never appear here (§5). */
  screening?: Record<string, string> | undefined;
  screeningIndex?: number | undefined;

  districtId?: string | undefined;
  cityId?: string | undefined;
  townId?: string | undefined;
  localityId?: string | undefined;
  /** What they typed, kept beside the matched id for the reviewer (§5.8). */
  locationText?: string | undefined;
  locationLevel?: LocationLevel | undefined;
  /** What they last typed at this level, so the prompt can show the matches. */
  locationSearch?: string | undefined;

  lastDonatedOn?: string | undefined;
  neverDonated?: boolean | undefined;

  /* --- the fix flow -------------------------------------------------- */
  /** Steps still to re-ask, in summary order. Empty means "back to summary". */
  fixing?: InterviewStep[] | undefined;
  /** Rows to mark "updated" on the returned summary. */
  changed?: InterviewStep[] | undefined;
  /** Ticks accumulating on the checklist while it stays open. */
  ticked?: InterviewStep[] | undefined;
  /** Where a donor arrived from, so signup can hand them back to it (§5). */
  returnToRequest?: string | undefined;
};

export type InterviewState = {
  readonly step: FlowStep;
  readonly draft: InterviewDraft;
  /** `profile` re-opens the summary for an existing donor (§5). */
  readonly flow: 'onboarding' | 'profile';
  readonly donorId?: string | undefined;
};

/** How long a half-finished interview survives before it is dropped. */
export const DRAFT_TTL_HOURS = 48;

/* -------------------------------------------------------------------------- */
/* Prompts, one per step, and the only place a question is worded             */
/* -------------------------------------------------------------------------- */

const choice = (label: string, data: string): Choice => ({ label, data });

/** Year buttons, newest first. A donor is far likelier to be 24 than 64. */
function yearChoices(today: CalendarDay, minAge: number, maxAge: number): Choice[] {
  const thisYear = Number(today.slice(0, 4));
  const years: Choice[] = [];
  for (let age = minAge; age <= maxAge; age += 1) {
    const year = thisYear - age;
    years.push(choice(String(year), `dob:y:${String(year)}`));
  }
  return years;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export async function promptFor(
  ctx: BotContext,
  state: InterviewState,
): Promise<OutgoingMessage> {
  const { draft } = state;

  switch (state.step) {
    case 'phone':
      return {
        text: MESSAGES.askPhone,
        /*
          The tap is the primary path and typing is the fallback, offered in the
          same breath (§5). A platform that cannot share contacts ignores the
          flag and the donor simply types, no branch, no second screen.
        */
        requestContact: true,
      };

    case 'name':
      return { text: MESSAGES.askName };

    case 'dob': {
      const { minAge, maxAge } = ctx.config.donor;
      // Year, then month, then day (§5). Age is never asked directly, because
      // people round it.
      if (draft.dob === undefined) {
        return {
          text: MESSAGES.askBirthYear,
          choices: yearChoices(ctx.clock.today(), minAge, maxAge),
        };
      }
      const parts = draft.dob.split('-');
      if (parts.length === 1) {
        return {
          text: MESSAGES.askBirthMonth,
          choices: MONTHS.map((month, index) =>
            choice(month, `dob:m:${String(index + 1).padStart(2, '0')}`),
          ),
        };
      }
      return {
        text: MESSAGES.askBirthDay,
        choices: Array.from({ length: daysInMonth(draft.dob) }, (_, i) =>
          choice(String(i + 1), `dob:d:${String(i + 1).padStart(2, '0')}`),
        ),
      };
    }

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
        choices: [
          ...BLOOD_GROUPS.map((group) => choice(bloodGroupLabel(group), `group:${group}`)),
          // §5: eight buttons plus "I don't know". Guessing is worse than not
          // knowing. Staff type the donor at their first donation.
          choice('I don’t know', 'group:unknown'),
        ],
      };

    case 'weight':
      return {
        text: MESSAGES.askWeight,
        choices: WEIGHT_BANDS.map((band) => choice(weightBandLabel(band), `weight:${band}`)),
      };

    case 'screening': {
      const questions = durableQuestionsFor(draft.sex ?? 'other');
      const question = questions[draft.screeningIndex ?? 0];
      if (!question) return { text: MESSAGES.askScreeningDone };
      return {
        text: question.text,
        /*
          `durable:`, not `screen:`. The journey's per-request questions own
          that prefix, and a callback routed to the wrong screening is a visit
          answer landing on a profile. The two really are different things
          (§5), so they do not share a namespace either.
        */
        choices: [choice('Yes', 'durable:yes'), choice('No', 'durable:no')],
      };
    }

    case 'location':
      return locationPrompt(ctx, draft);

    case 'last_donation':
      return {
        text: MESSAGES.askLastDonation,
        choices: [
          choice('I have never donated', 'donated:never'),
          choice('Within the last 3 months', 'donated:recent'),
          choice('3–6 months ago', 'donated:3to6'),
          choice('More than 6 months ago', 'donated:older'),
        ],
      };

    case 'summary':
      return summaryMessage(ctx, state);

    case 'fix_choose':
      return checklistMessage(draft);
  }
}

function daysInMonth(partial: string): number {
  const [year, month] = partial.split('-');
  if (year === undefined || month === undefined) return 31;
  return new Date(Number(year), Number(month), 0).getDate();
}

async function locationPrompt(
  ctx: BotContext,
  draft: InterviewDraft,
): Promise<OutgoingMessage> {
  const level = draft.locationLevel ?? 'district';

  if (level === 'district') {
    const districts = await listDistricts(ctx);
    return {
      text: MESSAGES.askDistrict,
      choices: districts.map((d) => choice(d.name, `loc:district:${d.id}`)),
    };
  }

  const parentId = parentFor(draft, level);
  if (parentId === undefined) {
    // Nothing above it was chosen, so start the chain again rather than offer a
    // list of everything in the dataset.
    const districts = await listDistricts(ctx);
    return {
      text: MESSAGES.askDistrict,
      choices: districts.map((d) => choice(d.name, `loc:district:${d.id}`)),
    };
  }

  /* --- they typed something: show what it matched -------------------- */
  if (draft.locationSearch !== undefined && draft.locationSearch !== '') {
    const matches = await searchChildren(ctx, parentId, draft.locationSearch);
    return {
      text: MESSAGES.locationMatches(draft.locationSearch),
      choices: matches.map((node) => choice(node.name, `loc:${level}:${node.id}`)),
    };
  }

  const children = await listChildren(ctx, parentId);
  /**
   * A short list is offered whole; a long one asks them to type (§5).
   *
   * Kozhikode has four cities and seventy-seven towns. Buttons for the first is
   * kinder than a type-ahead; buttons for the second is a wall.
   */
  if (children.length <= 12) {
    return {
      text: MESSAGES.askLocationLevel(level),
      choices: children.map((node) => choice(node.name, `loc:${level}:${node.id}`)),
    };
  }

  return { text: MESSAGES.askLocationTypeAhead(level) };
}

const parentFor = (draft: InterviewDraft, level: LocationLevel): string | undefined => {
  switch (level) {
    case 'district':
      return undefined;
    case 'city':
      return draft.districtId;
    case 'town':
      return draft.cityId;
    case 'locality':
      return draft.townId;
  }
};

/* -------------------------------------------------------------------------- */
/* The summary                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The phone, masked (§5).
 *
 * The donor knows their own number; anyone reading over their shoulder in a
 * waiting room does not need it.
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return phone;
  return `${phone.slice(0, phone.length - 8)}••• ••${digits.slice(-3)}`;
}

export type SummaryRow = {
  readonly step: InterviewStep;
  readonly number: number;
  readonly label: string;
  readonly value: string;
  /** Extra lines under the row. The screening answers in the donor's terms. */
  readonly detail?: readonly string[];
  /** Marked "updated" because the donor just changed it (§5). */
  readonly changed: boolean;
};

/**
 * Every answer, played back.
 *
 * Derived consequences are shown **as consequences** (§5): an age from the date
 * of birth, a next-eligible date from the last donation. A donor should leave
 * signup knowing when to expect to hear from us.
 */
export async function summaryRows(
  ctx: BotContext,
  draft: InterviewDraft,
): Promise<SummaryRow[]> {
  const changed = new Set(draft.changed ?? []);
  const today = ctx.clock.today();

  const dob = parseCalendarDay(draft.dob ?? '');
  const location = await describeLocation(ctx, draft);

  const rows: SummaryRow[] = INTERVIEW_STEPS.map((step) => {
    const base = {
      step,
      number: rowNumberOf(step),
      label: STEP_LABELS[step],
      changed: changed.has(step),
    };

    switch (step) {
      case 'phone':
        return {
          ...base,
          value: draft.phone
            ? `${maskPhone(draft.phone)}${draft.phoneVerified === true ? '  (verified)' : ''}`
            : '-',
        };
      case 'name':
        return { ...base, value: draft.name ?? '-' };
      case 'dob':
        return {
          ...base,
          value: dob ? `${dob}  (age ${String(ageOn(dob, today))})` : '-',
        };
      case 'sex':
        return { ...base, value: draft.sex ? sexLabel(draft.sex) : '-' };
      case 'blood_group':
        return {
          ...base,
          value:
            draft.groupUnknown === true || draft.bloodGroup === undefined
              ? 'Not known yet. Staff will type you at your first donation'
              : `${bloodGroupLabel(draft.bloodGroup as BloodGroup)}  (to be confirmed by staff at your first donation)`,
        };
      case 'weight':
        return { ...base, value: draft.weightBand ? weightBandLabel(draft.weightBand) : '-' };
      case 'screening':
        return {
          ...base,
          value: 'You told us:',
          detail: durableSummaryLines(draft.sex ?? 'other', draft.screening ?? {}).map(
            (line) => `${line.text}${line.clear ? '  ✓' : '. We will check this with you'}`,
          ),
        };
      case 'location':
        return { ...base, value: location === '' ? '-' : location };
      case 'last_donation':
        return { ...base, value: lastDonationValue(ctx, draft) };
    }
  });

  return rows;
}

const sexLabel = (sex: Sex): string =>
  sex === 'female' ? 'Female' : sex === 'male' ? 'Male' : 'Other';

function lastDonationValue(ctx: BotContext, draft: InterviewDraft): string {
  if (draft.neverDonated === true) return 'Never donated';
  const day = parseCalendarDay(draft.lastDonatedOn ?? '');
  if (!day) return '-';

  const eligible = nextEligibleOn(day, draft.sex ?? 'other', ctx.config.donor.intervalDays);
  return eligible
    ? `${day}. You can donate again from ${eligible}`
    : day;
}

export async function summaryMessage(
  ctx: BotContext,
  state: InterviewState,
): Promise<OutgoingMessage> {
  const rows = await summaryRows(ctx, state.draft);

  const lines = rows.flatMap((row) => {
    const head = `${String(row.number)}  ${row.label}: ${row.value}${row.changed ? '  (updated)' : ''}`;
    return [head, ...(row.detail ?? []).map((line) => `      ${line}`)];
  });

  return {
    text: `${MESSAGES.summaryTitle}\n\n${lines.join('\n')}\n\n${MESSAGES.consentBody}`,
    choices: [
      choice('Yes, this is correct', 'sum:confirm'),
      choice('Fix something', 'sum:fix'),
      /*
        The third ending §5 asks for: "not now" is not "delete me". The
        registration is kept and dormant, and turning it on later is one word.
        Making somebody retype ten answers to change their mind loses them
        twice.
      */
      choice('Not now', 'sum:decline'),
    ],
  };
}

/**
 * The checklist (§5).
 *
 * Ticks accumulate and the list stays open, so somebody who got three answers
 * wrong fixes three answers once rather than making three round trips through
 * the summary.
 */
export function checklistMessage(draft: InterviewDraft): OutgoingMessage {
  const ticked = new Set(draft.ticked ?? []);

  return {
    text: MESSAGES.fixWhich,
    choices: [
      ...INTERVIEW_STEPS.map((step) =>
        choice(
          `${ticked.has(step) ? '☑' : '☐'} ${String(rowNumberOf(step))} ${STEP_LABELS[step]}`,
          `fix:toggle:${step}`,
        ),
      ),
      choice(`Fix these (${String(ticked.size)})`, 'fix:go'),
      choice('Cancel', 'fix:cancel'),
    ],
  };
}
