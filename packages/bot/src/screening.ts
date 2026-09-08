/**
 * The donor health questionnaire (§5, §2.7).
 *
 * Six questions, and the wording matters as much as the logic. Two rules:
 *
 *  1. **A "no" is never a verdict.** An answer that stops this donation is a
 *     deferral for *this request*, phrased as "not today", and it does not close
 *     the door. §2.7 forbids "rejected", "eliminated" and "banned" outright.
 *  2. **Durable and temporary answers are different things** (§5). "Have you
 *     ever had jaundice" belongs to the person and is written to
 *     `donor_screening_answers`. "Did you eat today" belongs to one visit, lives
 *     on the journey row, and must never reach the profile — a temporary answer
 *     stored as durable would defer somebody permanently for having skipped
 *     breakfast once.
 *
 * This is not a medical assessment and does not claim to be. The pre-donation
 * check happens on site and is the one that decides (§12.6); this only avoids
 * asking somebody to make a trip that will obviously end in a deferral.
 */

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
};

export const SCREENING_QUESTIONS: readonly ScreeningQuestion[] = [
  {
    key: 'well_today',
    text: 'Are you feeling well today — no fever, cold or infection?',
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
  {
    key: 'chronic_condition',
    text:
      'Do you have a heart condition, uncontrolled diabetes, epilepsy, or any condition you ' +
      'take regular medication for?',
    proceedOn: 'no',
    scope: 'durable',
  },
  {
    key: 'transmissible_infection',
    text:
      'Have you ever been told you have hepatitis B or C, HIV, or another infection that can ' +
      'pass through blood?',
    proceedOn: 'no',
    scope: 'durable',
  },
];

export const QUESTION_COUNT = SCREENING_QUESTIONS.length;

export const questionAt = (index: number): ScreeningQuestion | undefined =>
  SCREENING_QUESTIONS[index];

/** True when this answer means the donation should not go ahead today. */
export const defersOn = (question: ScreeningQuestion, answer: 'yes' | 'no'): boolean =>
  answer !== question.proceedOn;

/**
 * The durable answers out of a completed set, for the profile.
 *
 * Only ever the durable ones, and only ever the flagging answer. Recording
 * "no, I have never had hepatitis" on the profile would be storing a health
 * datum that changes nothing, which §2.10 says not to do.
 */
export function durableAnswersFrom(
  answers: Readonly<Record<string, string>>,
): { questionKey: string; answer: string }[] {
  return SCREENING_QUESTIONS.filter(
    (question) =>
      question.scope === 'durable' &&
      answers[question.key] !== undefined &&
      defersOn(question, answers[question.key] as 'yes' | 'no'),
  ).map((question) => ({
    questionKey: question.key,
    answer: answers[question.key] ?? '',
  }));
}

/**
 * A durable "yes, I have hepatitis" is a permanent deferral, and the donor
 * should not be asked again — that is `durable_flag_status`, not a rejection,
 * and the difference is whether the person is ever contacted again about
 * something they cannot change.
 */
export const isPermanentDeferral = (questionKey: string): boolean =>
  questionKey === 'transmissible_infection';
