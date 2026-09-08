/**
 * Everything a donor is ever told, in one file (§2.7, §5).
 *
 * Donor-facing copy is held apart from the staff vocabulary in
 * `packages/domain` because the two are deliberately different registers: a ward
 * needs "Date required" and a person needs "Needed by". Both are correct; one
 * compromise for everyone would be worse than either.
 *
 * Four rules the wording here keeps, and each is a rule because getting it
 * wrong causes a specific harm:
 *
 *  1. **A deferral is never a verdict.** "Not today" — never "rejected",
 *     "eliminated" or "banned". The person is not being judged, and a donor who
 *     reads a temporary deferral as a permanent one does not come back.
 *  2. **A stand-down thanks them.** Somebody who agreed to give blood and is no
 *     longer needed has done nothing wrong, and the message that tells them so
 *     is the one this system most has to get right (§7.6).
 *  3. **No clinical claim, ever.** The pre-donation assessment happens on site.
 *     Nothing here says a person is fit to donate; it says they are being asked.
 *  4. **No patient detail reaches a donor.** The hospital and the group, never a
 *     name, a ward or a diagnosis (§2.10).
 */

import { bloodGroupLabel, weightBandLabel, type BloodGroup } from '@blood-connect/domain';

/** Stored on every consent row, so "they agreed to *this text*" is answerable. */
export const WORDING_VERSION = '1.0.0';

export type HospitalSnapshot = {
  readonly hospitalName: string;
  readonly hospitalAddress: string;
};

const group = (value: string): string => bloodGroupLabel(value as BloodGroup);

export const MESSAGES = {
  /* ---------------------------------------------------------- onboarding */

  welcome:
    'Hello. This is Blood Connect. It asks people who have chosen to help whether they ' +
    'can give blood when a patient nearby needs it.\n\n' +
    'Registering takes about a minute. You can stop at any point, and nothing is saved ' +
    'until the end.',

  askName: 'What name should the blood centre call you by?',
  askPhone:
    'A phone number the centre can reach you on. Only the blood centre sees it, and only ' +
    'once you have agreed to give for a specific patient.',
  askDob: 'Your date of birth, as YYYY-MM-DD. It is used to check the age range, nothing else.',
  askSex:
    'This sets how long you wait between donations, which differs by sex under the national ' +
    'guideline.',
  askBloodGroup:
    'Your blood group, if you know it. The centre re-tests every unit before it is used, so ' +
    'this only decides who gets asked.',
  askWeight: 'Roughly what do you weigh? A band is enough.',
  askDistrict: 'Which district are you in? Requests nearest to you come first.',

  consentTitle: 'Before you finish',
  consentBody:
    'By registering you agree that Blood Connect may:\n' +
    '• contact you on this app when a patient near you needs your blood group,\n' +
    '• share your name and phone number with the blood centre once you agree to give,\n' +
    '• keep the details you gave above.\n\n' +
    'You can stop being contacted, pause for a while, or delete everything, at any time. ' +
    'This is not a medical assessment — the centre checks you on the day.',

  registered: (nextEligible: string | null): string =>
    nextEligible === null
      ? 'You are registered. You will hear from us only when someone near you needs your ' +
        'blood group.'
      : `You are registered. Based on your last donation you can give again from ${nextEligible}. ` +
        'You will hear from us only when someone near you needs your blood group.',

  abandoned:
    'Nothing was saved. Send anything to start again whenever you like.',

  /* -------------------------------------------------------------- the ask */

  request: (bloodGroup: string, neededBy: string, hospital: HospitalSnapshot): string =>
    `Someone at ${hospital.hospitalName} needs ${group(bloodGroup)} blood by ${neededBy}.\n\n` +
    'Can you give? There are a few short questions first, and the centre checks you on the ' +
    'day either way.',

  /* ---------------------------------------------------------- the answers */

  declined:
    'Thank you for answering. You will be asked again next time — saying no now changes ' +
    'nothing about that.',

  /**
   * The loser of the last-unit race (§7.3), and it is phrased as good news
   * because it is: enough people came forward. Anything that reads as "you were
   * too slow" would be both false and discouraging.
   */
  waitlisted:
    'Enough people have already agreed for this one — thank you for offering. You are on ' +
    'the waiting list, and we will message you straight away if a place opens up.',

  promoted: (hospital: HospitalSnapshot, neededBy: string): string =>
    'A place has opened up for the request you offered for.\n\n' +
    `${hospital.hospitalName}\n${hospital.hospitalAddress}\nBy ${neededBy}.\n\n` +
    'Please bring a photo ID. The centre will check you before you give.',

  confirmed: (hospital: HospitalSnapshot, neededBy: string): string =>
    'Thank you. The centre is expecting you.\n\n' +
    `${hospital.hospitalName}\n${hospital.hospitalAddress}\nBy ${neededBy}.\n\n` +
    'Please bring a photo ID. The centre will check you before you give — that check is ' +
    'the one that decides, not these questions.',

  /**
   * A deferral, never a verdict (§2.7). It names this request only, gives no
   * medical opinion, and does not close the door.
   */
  deferred:
    'Thank you for answering honestly. For this request, it is better not to — but that is ' +
    'about today, not about you, and it does not stop you giving another time. If you want ' +
    'to know more, the blood centre can talk it through with you.',

  /* -------------------------------------------------------- the endings */

  /**
   * The message this whole system must not fail to send (§7.6, §14). Somebody
   * agreed to give blood and is no longer needed; they have done nothing wrong,
   * and the message says so first.
   */
  standDown: (reason: 'completed' | 'cancelled' | 'expired'): string =>
    'Thank you — you are no longer needed for that request.\n\n' +
    (reason === 'completed'
      ? 'Enough people came forward and the patient has what they need.'
      : reason === 'cancelled'
        ? 'The hospital has withdrawn the request.'
        : 'The request has passed the day the blood was needed.') +
    '\n\nPlease do not travel to the centre for this one. We will ask you again next time.',

  thanks: (nextEligible: string): string =>
    'Thank you — the centre has recorded your donation.\n\n' +
    `You can give again from ${nextEligible}. We will not ask you before then.`,

  noShowNoted:
    'The centre recorded that you were not able to come. That is completely fine, and you ' +
    'will be asked again next time.',

  /* ------------------------------------------------------------ controls */

  snoozed: (until: string): string =>
    `You will not be asked again until ${until}. Send "start" any time to change that.`,

  optedOut:
    'You will not be contacted again. Your details stay with the blood centre only as long ' +
    'as the law requires. Send "start" if you ever want to come back.',

  /**
   * Said plainly **before** deleting, in one sentence (§5). A confirmation step
   * that hides what is about to happen is not consent.
   */
  confirmDeletion:
    'This deletes your name, phone number and everything you told us, permanently, and it ' +
    'cannot be undone. Records of donations you already made stay with the blood centre ' +
    'without your name attached, because the law requires that. Delete everything?',

  deleted:
    'Everything personal has been deleted. Thank you for the blood you gave.',

  /* -------------------------------------------------------------- errors */

  notRegistered:
    'You are not registered yet. Send "start" and it takes about a minute.',

  alreadyAnswered:
    'You have already answered this one — nothing more to do.',

  requestClosed:
    'That request has already ended. Thank you for coming back to it.',

  unknown:
    'Sorry, I did not understand that. Send "help" to see what I can do.',

  help:
    'What I can do:\n' +
    '• "start" — register, or change your details\n' +
    '• "pause" — stop being asked for a while\n' +
    '• "stop" — stop being asked at all\n' +
    '• "delete" — remove everything about you\n\n' +
    'This service does not give medical advice. The blood centre checks you on the day.',
} as const;

export const weightPrompt = (band: string): string => weightBandLabel(band as never);
