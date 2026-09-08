/**
 * Everything a donor is ever told, in one file (§2.7, §5).
 *
 * Donor-facing copy is held apart from the staff vocabulary in
 * `packages/domain` because the two are deliberately different registers: a ward
 * needs "Date required" and a person needs "Needed by". Both are correct; one
 * compromise for everyone would be worse than either.
 *
 * **Short, warm, and one question at a time.** These arrive on a phone, often
 * from somebody standing up. A paragraph of preamble before the question is a
 * paragraph nobody reads, and a question that needs re-reading gets the wrong
 * answer. Every prompt below is one line where it can be, with the reason
 * underneath only where the reason changes what somebody answers.
 *
 * Four rules the wording keeps, each because getting it wrong causes a specific
 * harm:
 *
 *  1. **A deferral is never a verdict.** "Not today" — never "rejected",
 *     "eliminated" or "banned" (§2.7). Somebody who reads a temporary deferral
 *     as a permanent one does not come back.
 *  2. **A stand-down thanks them first.** Somebody who agreed to give blood and
 *     is no longer needed has done nothing wrong (§7.6).
 *  3. **No clinical claim, ever.** The pre-donation check happens on site and is
 *     the one that decides. Nothing here says a person is fit to donate.
 *  4. **No patient detail reaches a donor.** The hospital and the group, never a
 *     name, a ward or a diagnosis (§2.10).
 */

import { bloodGroupLabel, type BloodGroup } from '@blood-connect/domain';

/** Stored on every consent row, so "they agreed to *this text*" is answerable. */
export const WORDING_VERSION = '2.0.0';

export type HospitalSnapshot = {
  readonly hospitalName: string;
  readonly hospitalAddress: string;
};

const group = (value: string): string => bloodGroupLabel(value as BloodGroup);

/** "11 Sep" — a date somebody reads at a glance, not an ISO string. */
export function readableDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  if (!year || !month || !date) return day;
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${String(date)} ${months[month - 1] ?? ''}`;
}

export const MESSAGES = {
  /* ---------------------------------------------------------- onboarding */

  /**
   * The first thing anybody sees, and it arrives without them typing a command
   * (§5). It says what this is and asks the first question in the same breath —
   * a welcome that ends without a question leaves somebody wondering what to do.
   */
  welcome:
    'Hello, and thank you for coming here.\n\n' +
    'Blood Connect asks people nearby when a patient needs blood. Registering ' +
    'takes about a minute, and nothing is saved until you agree at the end.',

  askName: 'What should we call you?',
  askPhone:
    'Your phone number, please.\n\n' +
    'Only the blood centre sees it, and only once you have agreed to give for ' +
    'a particular patient.',
  askDob: 'Your date of birth, please — like 1995-04-23.',
  askSex:
    'And are you male or female?\n\n' +
    'This only sets how long you wait between donations.',
  askBloodGroup:
    'Which blood group are you?\n\n' +
    'If you are not certain, pick your best guess — the centre tests every ' +
    'unit before it is used.',
  askWeight: 'Roughly what do you weigh?',
  askDistrict: 'Last one — which district are you in?',

  consentTitle: 'Almost done',
  consentBody:
    'If you agree, we will:\n' +
    '• message you when someone near you needs your blood group\n' +
    '• share your name and number with the blood centre once you say yes to a ' +
    'particular patient\n' +
    '• keep what you told us above\n\n' +
    'You can pause, stop, or delete everything at any time.\n\n' +
    'This is not a medical check — the centre sees you on the day.',

  registered: (name: string): string =>
    `Thank you, ${name}. You are registered.`,

  abandoned: 'No problem — nothing was saved. Say hello any time to start again.',

  /* -------------------------------------------------------------- the ask */

  request: (bloodGroup: string, neededBy: string, hospital: HospitalSnapshot): string =>
    `Someone at ${hospital.hospitalName} needs ${group(bloodGroup)} blood by ` +
    `${readableDay(neededBy)}.\n\nCould you give?`,

  /* ---------------------------------------------------------- the answers */

  declined:
    'Thank you for letting us know. We will ask again next time — saying no ' +
    'now changes nothing.',

  /**
   * The loser of the last-unit race (§7.3), phrased as the good news it is:
   * enough people came forward. Anything reading as "you were too slow" would
   * be untrue and discouraging.
   */
  waitlisted:
    'Thank you for offering. Enough people have already said yes to this one, ' +
    'so you are on the waiting list — we will message you straight away if a ' +
    'place opens.',

  promoted: (hospital: HospitalSnapshot, neededBy: string): string =>
    'A place has opened up, if you can still give.\n\n' +
    `${hospital.hospitalName}\n${hospital.hospitalAddress}\n` +
    `By ${readableDay(neededBy)}\n\n` +
    'Please bring a photo ID.',

  confirmed: (hospital: HospitalSnapshot, neededBy: string): string =>
    'Thank you — the centre is expecting you.\n\n' +
    `${hospital.hospitalName}\n${hospital.hospitalAddress}\n` +
    `By ${readableDay(neededBy)}\n\n` +
    'Please bring a photo ID. The centre will check you before you give.',

  /** A deferral, never a verdict (§2.7). This request only, and no diagnosis. */
  deferred:
    'Thank you for answering honestly.\n\n' +
    'For this one it is better not to — but that is about today, not about ' +
    'you, and you can still give another time. The blood centre can talk it ' +
    'through if you would like.',

  /* ---------------------------------------------------------- the endings */

  /**
   * The message this system most has to get right (§7.6, §14). Somebody agreed
   * to give blood and is no longer needed; they have done nothing wrong, and
   * the first line says so.
   */
  standDown: (reason: 'completed' | 'cancelled' | 'expired'): string =>
    'Thank you — you are no longer needed for that request.\n\n' +
    (reason === 'completed'
      ? 'Enough people came forward and the patient has what they need.'
      : reason === 'cancelled'
        ? 'The hospital has withdrawn it.'
        : 'It has passed the day the blood was needed.') +
    '\n\nPlease do not travel for this one. We will ask you again next time.',

  thanks: (nextEligible: string): string =>
    'Thank you — the centre has recorded your donation.\n\n' +
    `You can give again from ${readableDay(nextEligible)}, and we will not ask ` +
    'before then.',

  noShowNoted:
    'The centre recorded that you could not come. That is completely fine, and ' +
    'we will ask again next time.',

  /* ------------------------------------------------------------ controls */

  snoozed: (until: string): string =>
    `Of course — we will not ask again until ${readableDay(until)}.`,

  optedOut:
    'Done. We will not contact you again.\n\n' +
    'Thank you for the time you gave. Say hello any time if you change your mind.',

  /** Said plainly **before** deleting, in one sentence (§5). */
  confirmDeletion:
    'This permanently deletes your name, number and everything you told us, ' +
    'and cannot be undone. Donations you already made stay with the blood ' +
    'centre without your name, because the law requires it.\n\n' +
    'Delete everything?',

  deleted: 'All deleted. Thank you for the blood you gave.',

  deletionCancelled: 'Nothing was deleted.',

  /* --------------------------------------------------------------- state */

  /**
   * What a registered donor sees when they say anything we do not recognise.
   *
   * Never "you are not registered" — that was being shown to people who had
   * just finished registering, which reads as though the whole minute was
   * wasted. If we know who somebody is, we say something useful about their
   * situation instead.
   */
  nothingNeeded: (bloodGroup: string): string =>
    `Nothing is needed right now.\n\nWe will message you the moment someone ` +
    `near you needs ${group(bloodGroup)} blood.`,

  needsHeading: (count: number): string =>
    count === 1 ? 'One request is open near you:' : `${String(count)} requests are open near you:`,

  needLine: (
    bloodGroup: string,
    units: number,
    neededBy: string,
    hospital: HospitalSnapshot,
  ): string =>
    `• ${String(units)} × ${group(bloodGroup)} by ${readableDay(neededBy)} — ${hospital.hospitalName}`,

  /** Appended to a line on the needs list, so it reads as part of it. */
  alreadyAsked: 'we have already messaged you about this one',

  notEligibleYet: (until: string): string =>
    `You can give again from ${readableDay(until)}. We will not ask before then.`,

  paused: (until: string): string =>
    `You are paused until ${readableDay(until)}. Say "resume" to start again sooner.`,

  resumed: 'Welcome back — we will ask you again when someone nearby needs your blood group.',

  /* -------------------------------------------------------------- errors */

  alreadyAnswered: 'You have already answered this one — nothing more to do.',

  requestClosed: 'That request has already ended. Thank you for coming back to it.',

  help:
    'You can say:\n' +
    '• "needs" — what is needed near you now\n' +
    '• "pause" — stop being asked for a while\n' +
    '• "resume" — start being asked again\n' +
    '• "stop" — stop being asked at all\n' +
    '• "delete" — remove everything about you\n\n' +
    'We do not give medical advice — the blood centre checks you on the day.',
} as const;
