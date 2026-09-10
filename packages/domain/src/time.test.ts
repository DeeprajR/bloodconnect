import { describe, expect, it } from 'vitest';

import {
  APP_TIMEZONE,
  addDays,
  calendarDay,
  compareDays,
  dayOf,
  daysBetween,
  endOfDay,
  parseCalendarDay,
  startOfDay,
  subtractDays,
} from './time.js';
import { deriveExpiry, isExpiredOn, daysUntilExpiry } from './expiry.js';

const day = (value: string) => {
  const parsed = parseCalendarDay(value);
  if (!parsed) throw new Error(`fixture is not a calendar day: ${value}`);
  return parsed;
};

describe('calendar days', () => {
  it('rejects a day the calendar does not have, rather than rolling it over', () => {
    expect(parseCalendarDay('2026-02-30')).toBeUndefined();
    expect(parseCalendarDay('2025-02-29')).toBeUndefined();
    expect(parseCalendarDay('2026-13-01')).toBeUndefined();
    expect(parseCalendarDay('2026-1-1')).toBeUndefined();
    expect(parseCalendarDay('not a day')).toBeUndefined();
  });

  it('accepts a leap day in a leap year', () => {
    expect(parseCalendarDay('2028-02-29')).toBe('2028-02-29');
  });

  it('builds a day from parts', () => {
    expect(calendarDay(2026, 9, 8)).toBe('2026-09-08');
  });

  it('orders days', () => {
    expect(compareDays(day('2026-09-07'), day('2026-09-08'))).toBe(-1);
    expect(compareDays(day('2026-09-08'), day('2026-09-08'))).toBe(0);
    expect(compareDays(day('2026-09-09'), day('2026-09-08'))).toBe(1);
  });
});

describe('day arithmetic across boundaries', () => {
  it('crosses a month end', () => {
    expect(addDays(day('2026-01-28'), 5)).toBe('2026-02-02');
    expect(addDays(day('2026-04-30'), 1)).toBe('2026-05-01');
  });

  it('crosses a year end', () => {
    expect(addDays(day('2026-12-30'), 3)).toBe('2027-01-02');
    expect(subtractDays(day('2027-01-02'), 3)).toBe('2026-12-30');
  });

  it('crosses a leap day', () => {
    expect(addDays(day('2028-02-28'), 1)).toBe('2028-02-29');
    expect(addDays(day('2028-02-28'), 2)).toBe('2028-03-01');
    // And the non-leap year immediately either side of it.
    expect(addDays(day('2027-02-28'), 1)).toBe('2027-03-01');
  });

  it('counts whole days between, signed', () => {
    expect(daysBetween(day('2026-09-01'), day('2026-09-08'))).toBe(7);
    expect(daysBetween(day('2026-09-08'), day('2026-09-01'))).toBe(-7);
    expect(daysBetween(day('2026-02-27'), day('2026-03-01'))).toBe(2);
    expect(daysBetween(day('2028-02-27'), day('2028-03-01'))).toBe(3);
  });
});

describe('a day becoming a moment (§5.2)', () => {
  it('ends a day at 23:59:59.999 local, not at midnight UTC', () => {
    // India is UTC+5:30 and observes no DST, so the end of 7 Sep locally is
    // 18:29:59.999 UTC, which is the whole point of converting in one place.
    expect(endOfDay(day('2026-09-07'), APP_TIMEZONE).toISOString()).toBe(
      '2026-09-07T18:29:59.999Z',
    );
    expect(startOfDay(day('2026-09-07'), APP_TIMEZONE).toISOString()).toBe(
      '2026-09-06T18:30:00.000Z',
    );
  });

  it('round-trips a day through an instant and back', () => {
    for (const value of ['2026-01-01', '2026-06-15', '2026-12-31', '2028-02-29']) {
      expect(dayOf(endOfDay(day(value)), APP_TIMEZONE)).toBe(value);
      expect(dayOf(startOfDay(day(value)), APP_TIMEZONE)).toBe(value);
    }
  });

  it('reads an instant as the local day, not the UTC one', () => {
    // 18:45 UTC on 7 Sep is already 00:15 on 8 Sep in Kolkata.
    expect(dayOf(new Date('2026-09-07T18:45:00.000Z'), APP_TIMEZONE)).toBe('2026-09-08');
  });

  it('handles a zone that does observe DST, if the deployment ever moves', () => {
    // Europe/London springs forward at 01:00 on 29 Mar 2026.
    expect(startOfDay(day('2026-03-29'), 'Europe/London').toISOString()).toBe(
      '2026-03-29T00:00:00.000Z',
    );
    expect(endOfDay(day('2026-03-29'), 'Europe/London').toISOString()).toBe(
      '2026-03-29T22:59:59.999Z',
    );
  });
});

describe('expiry arithmetic (§4)', () => {
  it('derives expiry from collection and shelf life, across a month end', () => {
    expect(deriveExpiry(day('2026-01-28'), 35)).toBe('2026-03-04');
    expect(deriveExpiry(day('2026-08-15'), 42)).toBe('2026-09-26');
    expect(deriveExpiry(day('2028-02-01'), 35)).toBe('2028-03-07');
  });

  it('leaves a unit usable through the whole of its expiry day', () => {
    const expires = day('2026-09-08');
    expect(isExpiredOn(expires, day('2026-09-07'))).toBe(false);
    expect(isExpiredOn(expires, day('2026-09-08'))).toBe(false);
    expect(isExpiredOn(expires, day('2026-09-09'))).toBe(true);
  });

  it('reports how overdue an expired unit is', () => {
    expect(daysUntilExpiry(day('2026-09-08'), day('2026-09-05'))).toBe(3);
    expect(daysUntilExpiry(day('2026-09-08'), day('2026-09-11'))).toBe(-3);
  });

  it('refuses a shelf life that is not a whole number of days', () => {
    expect(() => deriveExpiry(day('2026-09-08'), 35.5)).toThrow();
    expect(() => deriveExpiry(day('2026-09-08'), -1)).toThrow();
  });
});
