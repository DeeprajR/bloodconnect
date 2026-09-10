/**
 * The donor health questions (§5, §2.7).
 *
 * **Two sets, asked at different times, and the distinction is the point.**
 *
 * | | Durable, at signup | Visit, at each request |
 * |---|---|---|
 * | Asks about | What does not change week to week | What changes today |
 * | A disqualifying answer | Flags the profile for a human; the donor is not matched until it is resolved | Defers the donor from **this request only**; the profile is untouched |
 * | Why | Re-asking these every time reads as distrust | The answer is only meaningful today |
 *
 * Storing a visit answer as durable would defer somebody for a year for having
 * skipped breakfast once; asking a durable question at every request would tell
 * a donor with a heart condition, eleven times, that we were not listening.
 *
 * Two rules of wording, from §2.7:
 *
 *  1. **An answer is never a verdict.** What stops a donation today is a
 *     *deferral*, phrased as "not today". "Rejected", "eliminated" and "banned"
 *     are forbidden outright.
 *  2. **Nothing is phrased as a diagnosis.** This is not a medical assessment
 *     and does not claim to be. The pre-donation check happens on site and is
 *     the one that decides (§12.6); this only avoids asking somebody to make a
 *     trip that will obviously end in a deferral.
 */

import type { Sex } from '@blood-connect/domain';

export type ScreeningQuestion = {
  readonly key: string;
  readonly text: string;
  /** The answer that allows the donation to proceed. */
  readonly proceedOn: 'yes' | 'no';
  /**
   * `durable` answers describe the person and are kept on the profile.
   * `visit` answers describe today and never leave the journey row.
   */
  readonly scope: 'durable' | 'visit';
  /**
   * Shown on the signup summary in the donor's own terms (§5).
   *
   * The summary plays back what they told us, not a score: somebody who
   * mis-tapped three screens ago finds out now rather than by being silently
   * excluded from every request for a year.
   */
  readonly summary?: string;
  /** Asked only of some donors. Pregnancy, which depends on the sex answer. */
  readonly appliesTo?: readonly Sex[];
};

/* -------------------------------------------------------------------------- */
/* Durable. Asked once, at signup                                             */
/* -------------------------------------------------------------------------- */

export const DURABLE_QUESTIONS: readonly ScreeningQuestion[] = [
  {
    key: 'long_term_condition',
    text:
      'Do you have a long-term illness, a heart condition, uncontrolled diabetes, ' +
      'epilepsy, or take regular medication for one?',
    proceedOn: 'no',
    scope: 'durable',
    summary: 'No long-term illness or medication',
  },
  {
    key: 'transmissible_infection',
    text:
      'Have you ever been told you have hepatitis B or C, HIV, or another infection that ' +
      'can pass through blood?',
    proceedOn: 'no',
    scope: 'durable',
    summary: 'No infection that passes through blood',
  },
  {
    /**
     * Asked only where it applies (§5): sex is collected to set the donation
     * interval and to decide whether this question is asked at all, never for
     * display.
     */
    key: 'pregnant_or_breastfeeding',
    text: 'Are you currently pregnant, or breastfeeding?',
    proceedOn: 'no',
    scope: 'durable',
    summary: 'Not currently pregnant or breastfeeding',
    appliesTo: ['female'],
  },
  {
    key: 'advised_not_to_donate',
    text: 'Has a doctor or a blood centre ever advised you not to donate?',
    proceedOn: 'no',
    scope: 'durable',
    summary: 'Never been advised not to donate',
  },
];

/**
 * The durable set for one donor, three questions, or four.
 *
 * §5 puts the whole set at "three or four taps", and this is why: the pregnancy
 * question is asked where it applies and skipped where it does not, rather than
 * being asked of everybody with an awkward opt-out.
 */
export const durableQuestionsFor = (sex: Sex): readonly ScreeningQuestion[] =>
  DURABLE_QUESTIONS.filter(
    (question) => question.appliesTo === undefined || question.appliesTo.includes(sex),
  );

/* -------------------------------------------------------------------------- */
/* Visit. Asked at each request                                               */
/* -------------------------------------------------------------------------- */

export const VISIT_QUESTIONS: readonly ScreeningQuestion[] = [
  {
    key: 'well_today',
    text: 'Are you feeling well today, no fever, cold or infection?',
    proceedOn: 'yes',
    scope: 'visit',
  },
  {
    key: 'eaten_today',
    text: 'Have you eaten in the last four hours?',
    proceedOn: 'yes',
    scope: 'visit',
  },
  {
    key: 'medication_or_antibiotics',
    text: 'Are you taking antibiotics, or have you finished a course in the last week?',
    proceedOn: 'no',
    scope: 'visit',
  },
  {
    key: 'recent_surgery_or_transfusion',
    text: 'Have you had surgery, a transfusion, or a tattoo or piercing in the last six months?',
    proceedOn: 'no',
    scope: 'visit',
  },
];

/**
 * What a request asks. Named for the journey that uses it, because "the
 * questions" is now ambiguous and a confusion here would put a durable answer
 * on a journey row.
 */
export const SCREENING_QUESTIONS = VISIT_QUESTIONS;
export const QUESTION_COUNT = VISIT_QUESTIONS.length;

export const questionAt = (index: number): ScreeningQuestion | undefined =>
  VISIT_QUESTIONS[index];

/* -------------------------------------------------------------------------- */
/* Reading answers                                                             */
/* -------------------------------------------------------------------------- */

/** True when this answer means the donation should not go ahead today. */
export const defersOn = (question: ScreeningQuestion, answer: 'yes' | 'no'): boolean =>
  answer !== question.proceedOn;

/**
 * The durable answers worth keeping, out of a completed signup set.
 *
 * Only the flagging ones. Recording "no, I have never had hepatitis" on the
 * profile would be storing a health datum that changes nothing, which §2.10
 * says not to do. The absence of a row is the answer.
 */
export function durableAnswersFrom(
  answers: Readonly<Record<string, string>>,
): { questionKey: string; answer: string }[] {
  return DURABLE_QUESTIONS.filter(
    (question) =>
      answers[question.key] !== undefined &&
      defersOn(question, answers[question.key] as 'yes' | 'no'),
  ).map((question) => ({
    questionKey: question.key,
    answer: answers[question.key] ?? '',
  }));
}

/**
 * A durable answer that should stop this donor being contacted at all, rather
 * than merely flagged.
 *
 * `durable_flag_status`, not a rejection. The difference is whether the person
 * is ever contacted again about something they cannot change. Everything else
 * flagged waits for a human to look at it.
 */
export const isPermanentDeferral = (questionKey: string): boolean =>
  questionKey === 'transmissible_infection';

/**
 * How the donor's durable answers read back on the summary (§5).
 *
 * Their own terms and their own order, with a tick against each one that is
 * clear. A flagged answer says what it means for them, not what it means to us.
 */
export function durableSummaryLines(
  sex: Sex,
  answers: Readonly<Record<string, string>>,
): { readonly text: string; readonly clear: boolean }[] {
  return durableQuestionsFor(sex).map((question) => {
    const answer = answers[question.key];
    const clear = answer !== undefined && !defersOn(question, answer as 'yes' | 'no');
    return {
      text: clear ? (question.summary ?? question.text) : `You told us: ${question.text}`,
      clear,
    };
  });
}
