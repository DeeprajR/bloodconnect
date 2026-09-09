/**
 * The human-readable blood request identifier, `DDMMYY-NNNNN` (§3, ADR 0010).
 *
 * It is a **separate column** from the primary key (§5.2): the UUIDv7 is what
 * rows join on, and this is what a doctor reads aloud in a corridor. The number
 * comes from the transactional counter in §7.1 — this file only formats and
 * parses it, and deliberately offers no way to invent one.
 *
 * **Why this shape.** The doctor reads it to the patient's bystander, who
 * carries it to the blood centre and it is typed at the counter. So it is short
 * enough to say once, the date leads because that is the part a person already
 * knows, and the counter prefills it — leaving five digits to type for a request
 * raised today.
 *
 * > **It identifies a request. It does not authenticate anybody.** Sequential
 * > within a day and therefore guessable, which is safe at a counter where a
 * > person is physically present and the centre verifies the patient by other
 * > means. Nothing keyed on this ID alone may ever be exposed publicly — no
 * > status page, no API lookup, no "track your request" link (ADR 0010 §4).
 */

import type { CalendarDay } from './time.js';

declare const requestIdBrand: unique symbol;

export type RequestNumber = string & { readonly [requestIdBrand]: 'RequestNumber' };

const PATTERN = /^(\d{2})(\d{2})(\d{2})-(\d{5})$/;

/** Five digits is 99,999 requests in one day — comfortably past any real load. */
export const REQUEST_SEQUENCE_DIGITS = 5;
export const MAX_REQUEST_SEQUENCE = 10 ** REQUEST_SEQUENCE_DIGITS - 1;

/** The `DDMMYY` half, from the day the request was raised. */
export function requestDatePart(day: CalendarDay): string {
  const [year, month, date] = day.split('-');
  if (year === undefined || month === undefined || date === undefined) {
    throw new Error(`not a calendar day: ${day}`);
  }
  return `${date}${month}${year.slice(2)}`;
}

export function formatRequestNumber(day: CalendarDay, sequence: number): RequestNumber {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > MAX_REQUEST_SEQUENCE) {
    // The counter has run out of room for the day. Failing loudly beats wrapping
    // round onto an identifier that already belongs to a request.
    throw new Error(`request sequence out of range for ${day}: ${String(sequence)}`);
  }
  return `${requestDatePart(day)}-${String(sequence).padStart(
    REQUEST_SEQUENCE_DIGITS,
    '0',
  )}` as RequestNumber;
}

export type ParsedRequestNumber = {
  readonly day: CalendarDay;
  readonly sequence: number;
};

/**
 * Parses what somebody typed at the counter.
 *
 * Tolerant of the separator and of spacing, because this is transcribed by ear:
 * `090926-00001`, `090926 00001` and `09092600001` are the same request. It is
 * **not** tolerant of a wrong length — a five-digit sequence read as four is a
 * different request, not a near miss, so it is refused rather than guessed at.
 */
export function parseRequestNumber(value: unknown): ParsedRequestNumber | undefined {
  if (typeof value !== 'string') return undefined;

  const cleaned = value.trim().replace(/[\s/.]+/g, '-').replace(/-+/g, '-');
  const withSeparator = /^\d{11}$/.test(cleaned)
    ? `${cleaned.slice(0, 6)}-${cleaned.slice(6)}`
    : cleaned;

  const match = PATTERN.exec(withSeparator);
  if (!match) return undefined;

  const [, date, month, year, sequence] = match;
  if (date === undefined || month === undefined || year === undefined) return undefined;

  const parsedSequence = Number(sequence);
  if (parsedSequence < 1) return undefined;

  const dayNumber = Number(date);
  const monthNumber = Number(month);
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) {
    return undefined;
  }

  /**
   * The century, assumed.
   *
   * Two digits is all a spoken identifier can carry, and this system does not
   * hold requests from the 1900s. A `69`/`70` split would be the usual choice;
   * `20YY` is the honest one here, because a blood request dated 1998 is a
   * typo rather than a record.
   */
  return {
    day: `20${year}-${month}-${date}` as CalendarDay,
    sequence: parsedSequence,
  };
}

export const isRequestNumber = (value: unknown): value is RequestNumber =>
  parseRequestNumber(value) !== undefined;
