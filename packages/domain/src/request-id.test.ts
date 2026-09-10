import { describe, expect, it } from 'vitest';

import {
  MAX_REQUEST_SEQUENCE,
  formatRequestNumber,
  isRequestNumber,
  parseRequestNumber,
  requestDatePart,
} from './request-id.js';
import type { CalendarDay } from './time.js';

const day = (value: string): CalendarDay => value as CalendarDay;

/**
 * `DDMMYY-NNNNN` (ADR 0010).
 *
 * The doctor reads it aloud to the patient's bystander, who carries it to the
 * blood centre where it is typed at a counter. Every test here is about that
 * journey: short enough to say, tolerant of how it arrives, and refusing
 * anything it cannot be sure of.
 */
describe('the request identifier', () => {
  it('is the date the request was raised, then the sequence', () => {
    expect(formatRequestNumber(day('2026-09-08'), 1)).toBe('080926-00001');
    expect(formatRequestNumber(day('2026-12-31'), 42)).toBe('311226-00042');
    expect(formatRequestNumber(day('2026-01-01'), 99999)).toBe('010126-99999');
  });

  it('pads the sequence so every ID is the same length', () => {
    // Read aloud and typed at a counter: a varying length is a transcription
    // error waiting to happen.
    expect(formatRequestNumber(day('2026-09-08'), 7)).toHaveLength(12);
    expect(formatRequestNumber(day('2026-09-08'), 12345)).toHaveLength(12);
  });

  it('refuses a sequence the format cannot hold', () => {
    // Wrapping round onto an identifier that already belongs to a request is
    // the one failure worth crashing over.
    expect(() => formatRequestNumber(day('2026-09-08'), 0)).toThrow();
    expect(() => formatRequestNumber(day('2026-09-08'), MAX_REQUEST_SEQUENCE + 1)).toThrow();
    expect(() => formatRequestNumber(day('2026-09-08'), 1.5)).toThrow();
  });

  it('round-trips', () => {
    const id = formatRequestNumber(day('2026-09-08'), 123);
    const parsed = parseRequestNumber(id);

    expect(parsed?.day).toBe('2026-09-08');
    expect(parsed?.sequence).toBe(123);
  });

  it('reads back what somebody typed at the counter', () => {
    // Transcribed by ear, so the separator is whatever they used, or none.
    for (const typed of ['080926-00001', '080926 00001', '08092600001', ' 080926/00001 ']) {
      expect(parseRequestNumber(typed)?.sequence).toBe(1);
    }
  });

  it('refuses a wrong-length sequence rather than guessing', () => {
    /**
     * A five-digit sequence heard as four is a **different request**, not a
     * near miss. Padding it would hand the counter somebody else's record.
     */
    expect(parseRequestNumber('080926-0001')).toBeUndefined();
    expect(parseRequestNumber('080926-000001')).toBeUndefined();
    expect(parseRequestNumber('80926-00001')).toBeUndefined();
  });

  it('refuses nonsense', () => {
    expect(parseRequestNumber('')).toBeUndefined();
    expect(parseRequestNumber('BR-2026-000001')).toBeUndefined();
    expect(parseRequestNumber('hello')).toBeUndefined();
    expect(parseRequestNumber(null)).toBeUndefined();
    expect(parseRequestNumber(12345)).toBeUndefined();
    // Sequence zero is never allocated.
    expect(parseRequestNumber('080926-00000')).toBeUndefined();
  });

  it('refuses a date that cannot exist', () => {
    expect(parseRequestNumber('321326-00001')).toBeUndefined();
    expect(parseRequestNumber('000026-00001')).toBeUndefined();
  });

  it('reads two digits of year as this century', () => {
    // All a spoken identifier can carry. A blood request dated 1998 would be a
    // typo rather than a record, so there is no 69/70 split to get wrong.
    expect(parseRequestNumber('080999-00001')?.day).toBe('2099-09-08');
  });

  it('builds the date part from the day', () => {
    expect(requestDatePart(day('2026-09-08'))).toBe('080926');
  });

  it('recognises its own output and nothing else', () => {
    expect(isRequestNumber(formatRequestNumber(day('2026-09-08'), 1))).toBe(true);
    expect(isRequestNumber('BR-2026-000001')).toBe(false);
  });
});
