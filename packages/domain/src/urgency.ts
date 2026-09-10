/**
 * How fast a request needs answering (§3, ADR 0010).
 *
 * The doctor does not type a date. They pick one of four levels at a bedside,
 * and everything downstream derives from it. The needed-by the donor bot and
 * the expiry sweep run on, and the order the centre queue sits in.
 *
 * **Three of the four land on today**, and that is the fact worth understanding
 * before reading anything below: the difference between an emergency and an
 * urgent request is how fast somebody walks, not what day it is. A calendar date
 * cannot express it. So urgency carries a second number, the time within which
 * an answer is expected, and that is the clock the top three actually run on.
 * The expiry sweep would not notice an unanswered emergency until midnight.
 *
 * Per §12 this reads no configuration; both figures arrive as parameters.
 */

import type { CalendarDay } from './time.js';
import { addDays } from './time.js';

/** Most urgent first. The centre queue is ordered by this array. */
export const URGENCIES = ['emergency', 'very_urgent', 'urgent', 'routine'] as const;
export type Urgency = (typeof URGENCIES)[number];

export const isUrgency = (value: unknown): value is Urgency =>
  typeof value === 'string' && (URGENCIES as readonly string[]).includes(value);

/**
 * What the doctor picks between (§2.7).
 *
 * Written as the time it means, not as a severity word: "Emergency" alone is a
 * judgement, and two clinicians will not draw the line in the same place.
 * "Now. Patient is bleeding" and "Today" are answerable without one.
 */
export const URGENCY_LABELS: Readonly<Record<Urgency, string>> = {
  emergency: 'Emergency, now',
  very_urgent: 'Very urgent, within hours',
  urgent: 'Urgent, today',
  routine: 'Routine, this week',
};

/** The short form, for a queue row where the column header carries the rest. */
export const URGENCY_SHORT: Readonly<Record<Urgency, string>> = {
  emergency: 'Emergency',
  very_urgent: 'Very urgent',
  urgent: 'Urgent',
  routine: 'Routine',
};

/**
 * Rank, for ordering. Lower is more urgent.
 *
 * A queue sorted by date alone puts a routine request raised on Monday above an
 * emergency raised this morning, because three of the four share today's date.
 */
export const urgencyRank = (urgency: Urgency): number => URGENCIES.indexOf(urgency);

/**
 * The day the blood is needed by.
 *
 * @param offsets `request.urgency_days`, days from today per level
 */
export function neededByFor(
  urgency: Urgency,
  today: CalendarDay,
  offsets: Readonly<Record<Urgency, number>>,
): CalendarDay {
  const days = offsets[urgency];
  // A negative offset would date a request in the past, which no configuration
  // should be able to do to a clinical record.
  return addDays(today, Number.isFinite(days) && days > 0 ? days : 0);
}

/**
 * How long the centre has to answer, in minutes, or `null` for routine.
 *
 * Routine has no minute clock on purpose: its needed-by is days away and the
 * expiry sweep is the right instrument. Flagging it after four hours would
 * train the counter to ignore the flag.
 */
export function responseMinutesFor(
  urgency: Urgency,
  thresholds: Readonly<Record<Urgency, number | null>>,
): number | null {
  const minutes = thresholds[urgency];
  return typeof minutes === 'number' && minutes > 0 ? minutes : null;
}

/**
 * Has this request been waiting longer than its urgency allows?
 *
 * The queue's alarm. `false` for anything with no minute clock, and for a
 * request that has already been answered. The caller passes only open ones.
 */
export function isPastResponseTarget(
  urgency: Urgency,
  submittedAt: Date,
  now: Date,
  thresholds: Readonly<Record<Urgency, number | null>>,
): boolean {
  const minutes = responseMinutesFor(urgency, thresholds);
  if (minutes === null) return false;
  return now.getTime() - submittedAt.getTime() > minutes * 60_000;
}

/** Whole minutes waited, for the queue to show beside the flag. */
export const minutesWaiting = (submittedAt: Date, now: Date): number =>
  Math.max(0, Math.floor((now.getTime() - submittedAt.getTime()) / 60_000));

/**
 * "8 minutes" · "2h 40m" · "3 days".
 *
 * Read at a glance from across a counter, so it never shows more precision than
 * the reader can act on.
 */
export function waitingLabel(minutes: number): string {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${String(minutes)} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(rest)}m`;
  }

  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day' : `${String(days)} days`;
}

/**
 * May the centre reserve or issue against this request with no patient attached?
 *
 * **Emergency only** (ADR 0010). Blood leaving a fridge has to be traceable to a
 * named person, which is what §4's traceability and the crossmatch sample both
 * assume, but waiting for a bystander to arrive before releasing units in a
 * real emergency is the worse failure. Every other urgency needs the patient
 * first, and the exception is recorded on the decision either way.
 */
export const mayDecideWithoutPatient = (urgency: Urgency): boolean =>
  urgency === 'emergency';
