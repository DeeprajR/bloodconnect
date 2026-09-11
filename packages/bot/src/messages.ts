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
 *  1. **A deferral is never a verdict.** "Not today", never "rejected",
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

/** "11 Sep". A date somebody reads at a glance, not an ISO string. */
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
   * (§5). It says what this is and asks the first question in the same breath.
   * A welcome that ends without a question leaves somebody wondering what to do.
   */
  welcome:
    'Hello, and thank you for coming.\n\n' +
    'We message people nearby when a patient needs blood.\n\n' +
    'A few quick questions, about a minute. Nothing is saved until you say so ' +
    'at the end.',

  askName: 'What is your name?',

  askPhone:
    'What is your phone number?\n\n' +
    'Only the blood centre sees it, and only after you say yes to a patient.',

  askDob: 'What is your date of birth? Like 1995-04-23.',

  /**
   * Year, then month, then day (§5).
   *
   * Age is never asked directly, because people round it, and a rounded age
   * either side of a boundary is the difference between being asked and never
   * being asked.
   */
  askBirthYear: 'Which year were you born?',
  askBirthMonth: 'Which month?',
  askBirthDay: 'Which day?',

  /** Only ever seen if the durable set is empty, which it is not. */
  askScreeningDone: 'Thank you.',

  askLastDonation:
    'When did you last give blood?\n\n' +
    'Pick the closest. If you know the date, you can type it as YYYY-MM-DD.',

  askLocationLevel: (level: string): string =>
    level === 'city'
      ? 'Which city or taluk?'
      : level === 'town'
        ? 'Which town?'
        : 'Which part of town?',

  /**
   * The type-ahead (§5).
   *
   * Kozhikode alone has seventy-seven towns; buttons for that is a wall. Two or
   * three characters is the whole interaction.
   */
  askLocationTypeAhead: (level: string): string =>
    level === 'town'
      ? 'Which town? Type the first few letters.'
      : level === 'city'
        ? 'Which city or taluk? Type the first few letters.'
        : 'Which part of town? Type the first few letters.',

  locationMatches: (term: string): string =>
    `Places matching “${term}”. Pick yours, or type a bit more.`,

  /* ------------------------------------------------------------- summary */

  summaryTitle: 'Please check these details.',

  summaryHelp:
    'All correct? Tap “Yes, this is correct”. To change something, tap ' +
    '“Fix something”, or send its row number.',

  fixWhich:
    'Which ones need fixing?\n\n' +
    'Tap each one, the list stays open, then “Fix these”.',

  fixHelp: 'Tap the rows that are wrong, or send their numbers like “3, 5, 7”.',

  /* ------------------------------------------------- where signup ends */

  /**
   * Registered, and matchable. The donor leaves knowing when to expect to hear
   * from us, which is what stops "I registered and nothing happened" (§5).
   */
  registeredMatchable: (name: string, eligibleFrom: string | null): string =>
    `Thank you, ${name}. You are registered.

` +
    (eligibleFrom === null
      ? 'We will message you when someone near you needs your blood group.'
      : `We will message you when someone near you needs your blood group, from ` +
        `${readableDay(eligibleFrom)} onwards.`),

  /**
   * Registered but not matchable. An **ending, not a rejection** (§5), and the
   * wording carries the difference. Each says what would change it.
   */
  registeredNotMatchable: (name: string, reason: string, until: string | null): string => {
    const why =
      reason === 'group_unknown'
        ? 'We do not know your blood group yet, so we cannot match you to a ' +
          'patient. The centre will type you at your first donation. You can ' +
          'walk in any time, and then we can.'
        : reason === 'under_weight'
          ? 'Giving blood needs a weight above the safe minimum, so we will not ' +
            'ask you for now. Nothing else changes, and you stay on the list.'
          : reason === 'flagged'
            ? 'One of your answers is something the centre checks with you ' +
              'first, so we will not ask you until they have. That is a ' +
              'conversation, not a no.'
            : until === null
              ? 'You are inside the gap between donations, so we will wait.'
              : `You gave recently, so the next time you can give is ` +
                `${readableDay(until)}. We will wait until then.`;

    return `Thank you, ${name}. You are registered.

${why}`;
  },

  /** Saved from the profile editor, re-acknowledged (§5). */
  profileSaved: 'Saved. Thank you for keeping it up to date.',

  /**
   * "Not now". Kept, dormant, and one word from being on (§5, §8).
   *
   * It thanks them and says exactly how to change their mind, because somebody
   * who declines today and cannot find the way back tomorrow is lost twice.
   * Nothing here asks them to reconsider now; that is what makes it an ending.
   */
  registeredDormant: (name: string): string =>
    `Thank you, ${name}. Your details are saved and we will not message you.

` +
    'Send "resume" whenever you want to be asked, nothing to fill in again.',

  /**
   * Asked, and it filled before they answered (§8).
   *
   * One line, and it thanks them: they did nothing wrong, and the card they are
   * holding is about to stop working.
   */
  covered: (bloodGroup: string): string =>
    `That ${group(bloodGroup)} request is covered now. Enough people came ` +
    'forward. Nothing to do, and thank you for being there.',
  askSex:
    'Are you male or female?\n\n' +
    'This only sets how long you wait between donations.',

  askBloodGroup:
    'What is your blood group?\n\n' +
    'Your best guess is fine. The centre tests every unit before it is used.',

  askWeight: 'Roughly what do you weigh?',

  askDistrict: 'Which district are you in?',

  consentTitle: 'Almost done',
  consentBody:
    'If you agree, we will:\n' +
    '• message you when someone near you needs your blood group\n' +
    '• share your name and number with the blood centre once you say yes to a ' +
    'particular patient\n' +
    '• keep what you told us above\n\n' +
    'You can pause, stop, or delete everything at any time.\n\n' +
    'This is not a medical check. The centre sees you on the day.',

  registered: (name: string): string =>
    `Thank you, ${name}. You are registered.`,

  abandoned: 'No problem, nothing was saved. Say hello any time to start again.',

  /**
   * One nudge, and never a second (§5).
   *
   * It says where they got to and what it costs to finish, and it does not ask
   * a question, somebody who has already walked away from a form should not be
   * met with another one. If they come back, the next thing they see is the
   * question they stopped on.
   */
  signupReminder:
    'You started registering with Blood Connect and did not finish. Your ' +
    'answers are still here.\n\n' +
    'Send anything to pick up where you left off. If you would rather not, ' +
    'just ignore this; we will not ask again.',

  /* ------------------------------------------------------ the demand board */

  boardEmpty:
    'Nothing is needed right now. That is good news. We will message you when ' +
    'something comes up.',

  boardHeading: (count: number): string =>
    count === 1 ? 'One patient needs blood right now.' : `${String(count)} patients need blood right now.`,

  /** No patient detail, ever: the hospital, the group, the units, the day (§2.10). */
  boardLine: (
    bloodGroup: string,
    unitsOutstanding: number,
    neededBy: string,
    hospital: HospitalSnapshot,
    matchesMe: boolean,
  ): string =>
    `${matchesMe ? '● ' : '○ '}${group(bloodGroup)}: ` +
    `${String(unitsOutstanding)} ${unitsOutstanding === 1 ? 'unit' : 'units'} still needed ` +
    `by ${readableDay(neededBy)}\n   ${hospital.hospitalName}` +
    (matchesMe ? '\n   You can give for this one.' : ''),

  boardKey: '● you can give   ○ a different group',

  /**
   * Why they cannot answer anything, said **once** and without a lecture (§5).
   *
   * A donor who understands why they were skipped stays; one who feels ignored
   * leaves. Each line says what would change it.
   */
  /**
   * Why this person cannot answer anything on the board (§5).
   *
   * `detail` is whatever the reason needs: a date for the two that name one, and
   * for `not_qualified` the sentence already stored on the donor when they
   * answered. Repeating the stored wording rather than writing a second version
   * of it is what stops the bot telling somebody two different things about the
   * same fact.
   */
  boardBlocked: (reason: string, detail: string): string => {
    switch (reason) {
      case 'not_registered':
        return 'Send anything to register. It takes about a minute, and then we can tell you which of these you could give for.';
      case 'not_qualified':
        return detail;
      case 'flagged':
        return 'The centre wants a word before your next donation, so we are not asking for now. That is a conversation, not a no.';
      case 'paused':
        return `You have paused messages until ${readableDay(detail)}. Send “resume” if you would like to be asked again.`;
      case 'interval':
        return `You gave recently. You can give again from ${readableDay(detail)}.`;
      default:
        return '';
    }
  },

  boardTapPrompt: 'Tap one you can give for, and I will ask you a few questions.',

  /** A visitor who tapped a request before registering (§5). */
  linkHeldForYou: (bloodGroup: string, hospital: HospitalSnapshot): string =>
    `Someone at ${hospital.hospitalName} needs ${group(bloodGroup)} blood.

` +
    'Let us get you registered first. It takes about a minute, and I will bring ' +
    'you straight back to this.',

  linkResumed: (bloodGroup: string, hospital: HospitalSnapshot): string =>
    `Now, back to why you came: ${group(bloodGroup)} blood is needed at ` +
    `${hospital.hospitalName}.`,

  linkGone:
    'That request has already been answered. Thank you for coming. Here is ' +
    'what else is needed.',

  /* -------------------------------------------------------------- the ask */

  request: (bloodGroup: string, neededBy: string, hospital: HospitalSnapshot): string =>
    `Someone at ${hospital.hospitalName} needs ${group(bloodGroup)} blood by ` +
    `${readableDay(neededBy)}.\n\nCould you give?`,

  /* ---------------------------------------------------------- the answers */

  declined:
    'Thank you for letting us know. We will ask again next time. Saying no ' +
    'now changes nothing.',

  /**
   * The loser of the last-unit race (§7.3), phrased as the good news it is:
   * enough people came forward. Anything reading as "you were too slow" would
   * be untrue and discouraging.
   */
  waitlisted:
    'Thank you for offering. Enough people have already said yes to this one, ' +
    'so you are on the waiting list. We will message you straight away if a ' +
    'place opens.',

  promoted: (hospital: HospitalSnapshot, neededBy: string): string =>
    'A place has opened up, if you can still give.\n\n' +
    `${hospital.hospitalName}\n${hospital.hospitalAddress}\n` +
    `By ${readableDay(neededBy)}\n\n` +
    'Please bring a photo ID.',

  confirmed: (hospital: HospitalSnapshot, neededBy: string): string =>
    'Thank you. The centre is expecting you.\n\n' +
    `${hospital.hospitalName}\n${hospital.hospitalAddress}\n` +
    `By ${readableDay(neededBy)}\n\n` +
    'Please bring a photo ID. The centre will check you before you give.',

  /** A deferral, never a verdict (§2.7). This request only, and no diagnosis. */
  deferred:
    'Thank you for answering honestly.\n\n' +
    'For this one it is better not to, but that is about today, not about ' +
    'you, and you can still give another time. The blood centre can talk it ' +
    'through if you would like.',

  /* ---------------------------------------------------------- the endings */

  /**
   * The message this system most has to get right (§7.6, §14). Somebody agreed
   * to give blood and is no longer needed; they have done nothing wrong, and
   * the first line says so.
   */
  standDown: (reason: 'completed' | 'cancelled' | 'expired'): string =>
    'Thank you. You are no longer needed for that request.\n\n' +
    (reason === 'completed'
      ? 'Enough people came forward and the patient has what they need.'
      : reason === 'cancelled'
        ? 'The hospital has withdrawn it.'
        : 'It has passed the day the blood was needed.') +
    '\n\nPlease do not travel for this one. We will ask you again next time.',

  thanks: (nextEligible: string): string =>
    'Thank you. The centre has recorded your donation.\n\n' +
    `You can give again from ${readableDay(nextEligible)}, and we will not ask ` +
    'before then.',

  noShowNoted:
    'The centre recorded that you could not come. That is completely fine, and ' +
    'we will ask again next time.',

  /* ------------------------------------------------------------ controls */

  snoozed: (until: string): string =>
    `Of course. We will not ask again until ${readableDay(until)}.`,

  optedOut:
    'Done. We will not contact you again.\n\n' +
    'Thank you for the time you gave. Say hello any time if you change your mind.',

  /** Said plainly **before** deleting, in one sentence (§5). */
  confirmDeletion:
    'This permanently deletes your name, number and everything you told us, ' +
    'and cannot be undone. Donations you already made stay with the blood ' +
    'centre without your name, because the law requires it.\n\n' +
    'Delete everything?',

  /**
   * What went, and what stayed, in two lines (§12.1).
   *
   * "Deletion confirms what was removed", and a donor told only "all deleted"
   * who later learns the centre still holds a donation record was misled. The
   * count is theirs to know.
   */
  deleted: (donationsKept: number): string =>
    donationsKept === 0
      ? 'All deleted. Your name, your number and everything you told us. Thank you.'
      : 'Deleted: your name, your number and everything you told us.\n\n' +
        `${String(donationsKept)} ${donationsKept === 1 ? 'donation stays' : 'donations stay'} ` +
        'on the blood centre’s record without your name, because the law ' +
        'requires it. Thank you for the blood you gave.',

  deletionCancelled: 'Nothing was deleted.',

  /* --------------------------------------------------------------- state */

  /**
   * What a registered donor sees when they say anything we do not recognise.
   *
   * Never "you are not registered", that was being shown to people who had
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
    `• ${String(units)} × ${group(bloodGroup)} by ${readableDay(neededBy)}: ${hospital.hospitalName}`,

  /** Appended to a line on the needs list, so it reads as part of it. */
  alreadyAsked: 'we have already messaged you about this one',

  notEligibleYet: (until: string): string =>
    `You can give again from ${readableDay(until)}. We will not ask before then.`,

  paused: (until: string): string =>
    `You are paused until ${readableDay(until)}. Say "resume" to start again sooner.`,

  resumed: 'Welcome back. We will ask you again when someone nearby needs your blood group.',

  /* -------------------------------------------------------------- errors */

  alreadyAnswered: 'You have already answered this one, nothing more to do.',

  requestClosed: 'That request has already ended. Thank you for coming back to it.',

  help:
    'You can tap a button below, or say:\n' +
    '• "needs" for what is needed near you now\n' +
    '• "donate" to tell us you would like to give\n' +
    '• "profile" to check or change your details\n' +
    '• "pause" to stop being asked for a while\n' +
    '• "resume" to start being asked again\n' +
    '• "stop" to stop being asked at all\n' +
    '• "delete" to remove everything about you\n\n' +
    'We do not give medical advice. The blood centre checks you on the day.',

  /* ---------------------------------------------------------------- menu */

  /**
   * The labels on the menu.
   *
   * Written as what the person wants, not as what the system does: "What is
   * needed now" rather than "Board", "I want to give" rather than "Declare
   * interest". Somebody opening this bot for the first time should not have to
   * learn a vocabulary in order to use it.
   */
  /* The two answers every yes/no question offers, worded once. */
  answerYes: 'Yes',
  answerNo: 'No',

  /* The two answers on a request card. */
  cardYes: 'Yes, I can give',
  cardNo: 'Not this time',

  menu: {
    needs: 'What is needed now',
    donate: 'I want to give',
    profile: 'My details',
    pause: 'Pause messages',
    resume: 'Start again',
    help: 'Help',
  },

  /* ------------------------------------------------- offering to donate */

  /**
   * Somebody who came looking rather than waiting to be asked (§5).
   *
   * Thanked first, then told the one thing that is true for them: either they
   * are in the pool and will be messaged, or something is standing in the way
   * and this is what it is. Never a form, and never silence.
   */
  interestNoted:
    'Thank you. We have noted that you would like to give.\n\n' +
    'You are in the pool, so we will message you the moment somebody near you ' +
    'needs your blood group. You do not have to wait for that: the centre ' +
    'takes walk-in donors during opening hours.',

  /**
   * The same thanks, for a donor nothing can currently be sent to.
   *
   * The reason follows the thanks rather than replacing it. A first-time donor
   * whose group nobody has typed yet is the commonest case here, and they are
   * the last person who should be met with a blank list.
   */
  interestBlocked: (reason: string): string =>
    'Thank you. We have noted that you would like to give.\n\n' + reason,

} as const;
