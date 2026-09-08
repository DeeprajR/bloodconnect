/**
 * The human-readable blood request identifier, `BR-YYYY-NNNNNN` (§3).
 *
 * It is a **separate column** from the primary key (§5.2): the UUIDv7 is what
 * rows join on, and this is what a doctor reads down a phone line. The number
 * comes from the transactional counter in §7.1 — this file only formats and
 * parses it, and deliberately offers no way to invent one.
 */

declare const requestIdBrand: unique symbol;

export type RequestNumber = string & { readonly [requestIdBrand]: 'RequestNumber' };

const PATTERN = /^BR-(\d{4})-(\d{6})$/;

/** Six digits is a million requests in a year — comfortably past any real load. */
export const REQUEST_SEQUENCE_DIGITS = 6;
export const MAX_REQUEST_SEQUENCE = 10 ** REQUEST_SEQUENCE_DIGITS - 1;

export function formatRequestNumber(year: number, sequence: number): RequestNumber {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new Error(`request year out of range: ${year}`);
  }
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > MAX_REQUEST_SEQUENCE) {
    // The counter has run out of room for the year. Failing loudly beats
    // wrapping round onto an identifier that already belongs to a request.
    throw new Error(`request sequence out of range for ${year}: ${sequence}`);
  }
  return `BR-${year}-${String(sequence).padStart(REQUEST_SEQUENCE_DIGITS, '0')}` as RequestNumber;
}

export type ParsedRequestNumber = { readonly year: number; readonly sequence: number };

export function parseRequestNumber(value: unknown): ParsedRequestNumber | undefined {
  if (typeof value !== 'string') return undefined;
  const match = PATTERN.exec(value.trim().toUpperCase());
  if (!match) return undefined;
  const [, year, sequence] = match;
  const parsedSequence = Number(sequence);
  if (parsedSequence < 1) return undefined;
  return { year: Number(year), sequence: parsedSequence };
}

export const isRequestNumber = (value: unknown): value is RequestNumber =>
  parseRequestNumber(value) !== undefined;
