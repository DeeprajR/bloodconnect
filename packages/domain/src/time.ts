/**
 * Calendar days, instants, and the one place a day becomes a moment (§5.2).
 *
 * The centre records a **day**, collected on, expires on, needed by, donated on
 *, and a day is not an instant. Storing "needed by 7 Sep" as a timestamp forces
 * a timezone guess at every read; storing it as a `date` and converting once,
 * here, means "expires 23:59 local" exists exactly once in the codebase.
 *
 * Nothing in this file reads the clock (§11.4). `today` is a parameter, always.
 */

/** The single configured application timezone (§5.2). */
export const APP_TIMEZONE = 'Asia/Kolkata';

declare const dayBrand: unique symbol;

/** An ISO calendar day, `YYYY-MM-DD`. Not a timestamp, and never printed as one. */
export type CalendarDay = string & { readonly [dayBrand]: 'CalendarDay' };

/** A moment in time. UTC underneath; only ever produced from a day plus a zone. */
export type Instant = Date;

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/** Builds a day from its parts, rejecting the ones the calendar does not have. */
export function calendarDay(year: number, month: number, day: number): CalendarDay {
  const parsed = parseCalendarDay(`${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`);
  if (!parsed) throw new Error(`not a calendar day: ${year}-${month}-${day}`);
  return parsed;
}

/**
 * Parse at the edge. Rejects 2026-02-30 rather than rolling it into March, so a
 * typed date required cannot become a silently different day.
 */
export function parseCalendarDay(value: unknown): CalendarDay | undefined {
  if (typeof value !== 'string') return undefined;
  const match = DAY_PATTERN.exec(value);
  if (!match) return undefined;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const utc = new Date(Date.UTC(year, month - 1, day));
  const roundTripped =
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day;
  return roundTripped ? (value as CalendarDay) : undefined;
}

const toUtcMillis = (day: CalendarDay): number => {
  const match = DAY_PATTERN.exec(day);
  /* istanbul ignore next. A CalendarDay cannot be built without matching */
  if (!match) throw new Error(`corrupt CalendarDay: ${day}`);
  const [, y, m, d] = match;
  return Date.UTC(Number(y), Number(m) - 1, Number(d));
};

const fromUtcMillis = (millis: number): CalendarDay => {
  const date = new Date(millis);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(
    date.getUTCDate(),
    2,
  )}` as CalendarDay;
};

const MILLIS_PER_DAY = 86_400_000;

/** Day arithmetic across month and year ends, and across leap days (§17). */
export const addDays = (day: CalendarDay, days: number): CalendarDay =>
  fromUtcMillis(toUtcMillis(day) + days * MILLIS_PER_DAY);

export const subtractDays = (day: CalendarDay, days: number): CalendarDay =>
  addDays(day, -days);

/** Whole calendar days from `from` to `to`; negative when `to` is earlier. */
export const daysBetween = (from: CalendarDay, to: CalendarDay): number =>
  Math.round((toUtcMillis(to) - toUtcMillis(from)) / MILLIS_PER_DAY);

/** -1, 0 or 1. Sortable, and readable at a call site. */
export const compareDays = (a: CalendarDay, b: CalendarDay): -1 | 0 | 1 => {
  const left = toUtcMillis(a);
  const right = toUtcMillis(b);
  return left < right ? -1 : left > right ? 1 : 0;
};

export const isBefore = (a: CalendarDay, b: CalendarDay): boolean => compareDays(a, b) < 0;
export const isAfter = (a: CalendarDay, b: CalendarDay): boolean => compareDays(a, b) > 0;
export const isSameOrBefore = (a: CalendarDay, b: CalendarDay): boolean =>
  compareDays(a, b) <= 0;
export const isSameOrAfter = (a: CalendarDay, b: CalendarDay): boolean =>
  compareDays(a, b) >= 0;

export const earliest = (a: CalendarDay, b: CalendarDay): CalendarDay =>
  isBefore(a, b) ? a : b;
export const latest = (a: CalendarDay, b: CalendarDay): CalendarDay =>
  isAfter(a, b) ? a : b;

/**
 * The zone's offset from UTC, in minutes, at a given instant. Derived from the
 * IANA database through Intl rather than hardcoded, so a zone that does observe
 * DST stays correct if the deployment ever moves out of India.
 */
function offsetMinutesAt(instant: Instant, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const field = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    /* istanbul ignore next, every requested field is in the format */
    if (!found) throw new Error(`missing ${type} formatting ${timeZone}`);
    return Number(found.value);
  };

  // `hour: '2-digit'` with hour12: false renders midnight as 24 in some ICU builds.
  const hour = field('hour') % 24;
  // Milliseconds come from the instant itself: Intl reports whole seconds, and
  // subtracting a truncated value from an untruncated one would fold the
  // remainder into the offset, which is how an end-of-day lands a second late.
  const asIfUtc = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    hour,
    field('minute'),
    field('second'),
    instant.getUTCMilliseconds(),
  );
  return (asIfUtc - instant.getTime()) / 60_000;
}

/** The instant a given wall-clock time on `day` occurs in `timeZone`. */
function zonedInstant(
  day: CalendarDay,
  hour: number,
  minute: number,
  second: number,
  millis: number,
  timeZone: string,
): Instant {
  const wallClock = toUtcMillis(day) + ((hour * 60 + minute) * 60 + second) * 1000 + millis;
  // Two passes: the first offset is read at an approximate instant, the second
  // at the corrected one, which settles any DST boundary the day straddles.
  let guess = wallClock - offsetMinutesAt(new Date(wallClock), timeZone) * 60_000;
  guess = wallClock - offsetMinutesAt(new Date(guess), timeZone) * 60_000;
  return new Date(guess);
}

/** Midnight opening the day, in the application timezone. */
export const startOfDay = (day: CalendarDay, timeZone: string = APP_TIMEZONE): Instant =>
  zonedInstant(day, 0, 0, 0, 0, timeZone);

/**
 * The last instant of the day, in the application timezone.
 *
 * This is "expires at 23:59 local" (§7). A demand needed by 7 Sep is live until
 * the end of 7 Sep where the hospital is, not until 00:00 UTC on it.
 */
export const endOfDay = (day: CalendarDay, timeZone: string = APP_TIMEZONE): Instant =>
  zonedInstant(day, 23, 59, 59, 999, timeZone);

/** The calendar day an instant falls on, in the application timezone. */
export function dayOf(instant: Instant, timeZone: string = APP_TIMEZONE): CalendarDay {
  const shifted = new Date(instant.getTime() + offsetMinutesAt(instant, timeZone) * 60_000);
  return fromUtcMillis(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()),
  );
}

/**
 * The clock as a port.
 *
 * The **type** lives here, beside the other time types, but nothing in this
 * package calls it: a domain rule that needs "now" takes `now: Instant` or
 * `today: CalendarDay` as a parameter (§3, §11.4). Implementations belong to the
 * adapter layer; `packages/testing` supplies the fake that makes interval,
 * expiry and wave-timing logic testable without freezing a global.
 */
export type Clock = {
  readonly now: () => Instant;
  readonly today: (timeZone?: string) => CalendarDay;
};
