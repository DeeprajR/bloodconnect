import { APP_TIMEZONE, dayOf, parseCalendarDay, type CalendarDay, type Clock, type Instant } from '@blood-connect/domain';

export type FakeClock = Clock & {
  /** Move time forward. Negative values are rejected. Time does not go back. */
  readonly advanceMs: (millis: number) => void;
  readonly advanceDays: (days: number) => void;
  /** Jump to 09:00 local on a given day, which is where most fixtures want to be. */
  readonly setDay: (day: CalendarDay | string) => void;
  readonly set: (instant: Instant) => void;
};

const MILLIS_PER_DAY = 86_400_000;

/**
 * A clock a test owns.
 *
 * Every use case takes `clock` in its context rather than calling `new Date()`,
 * so the boundary cases the spec cares about, exactly 18 years old, exactly at
 * the interval, the day a unit expires, are asserted by moving this, not by
 * hoping the suite runs on a convenient date.
 */
export function createFakeClock(start: Instant | string = '2026-01-01T09:00:00.000Z'): FakeClock {
  let current = typeof start === 'string' ? new Date(start) : new Date(start.getTime());
  if (Number.isNaN(current.getTime())) throw new Error(`not an instant: ${String(start)}`);

  return {
    now: () => new Date(current.getTime()),
    today: (timeZone: string = APP_TIMEZONE) => dayOf(current, timeZone),
    advanceMs(millis: number): void {
      if (millis < 0) throw new Error('the clock does not run backwards; use set()');
      current = new Date(current.getTime() + millis);
    },
    advanceDays(days: number): void {
      this.advanceMs(days * MILLIS_PER_DAY);
    },
    setDay(day: CalendarDay | string): void {
      const parsed = parseCalendarDay(day);
      if (!parsed) throw new Error(`not a calendar day: ${day}`);
      current = new Date(`${parsed}T09:00:00.000Z`);
    },
    set(instant: Instant): void {
      current = new Date(instant.getTime());
    },
  };
}

/*
 * There is deliberately no `systemClock` here. A process that reads the wall
 * clock is an adapter, and adapters own their own; exporting one from the test
 * package would give production code a reason to import it (§3).
 */
