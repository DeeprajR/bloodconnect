import { describe, expect, it } from 'vitest';

import {
  WEIGHT_BANDS,
  ageOn,
  daysUntilEligible,
  effectiveWeightKg,
  hasIntervalElapsed,
  isWithinAgeBounds,
  nextEligibleOn,
  qualifyDonor,
  weightKgFromBand,
  type DonationIntervals,
} from './donor.js';
import { parseCalendarDay, type CalendarDay } from './time.js';

const day = (value: string): CalendarDay => {
  const parsed = parseCalendarDay(value);
  if (!parsed) throw new Error(`fixture is not a calendar day: ${value}`);
  return parsed;
};

const INTERVALS: DonationIntervals = { male: 90, female: 120, other: 120 };
const BOUNDS = { minYears: 18, maxYears: 65 };

describe('age', () => {
  it('counts completed years, not calendar-year differences', () => {
    expect(ageOn(day('2008-09-09'), day('2026-09-08'))).toBe(17);
    expect(ageOn(day('2008-09-08'), day('2026-09-08'))).toBe(18);
    expect(ageOn(day('2008-01-01'), day('2026-09-08'))).toBe(18);
  });

  it('handles a leap-day birthday in a non-leap year', () => {
    // Born 29 Feb 2008; on 28 Feb 2026 the birthday has not arrived, on 1 Mar it has.
    expect(ageOn(day('2008-02-29'), day('2026-02-28'))).toBe(17);
    expect(ageOn(day('2008-02-29'), day('2026-03-01'))).toBe(18);
  });

  it('is inclusive at exactly 18 and exactly 65 (§7.7)', () => {
    const today = day('2026-09-08');
    expect(isWithinAgeBounds(day('2008-09-08'), today, BOUNDS)).toBe(true);
    expect(isWithinAgeBounds(day('2008-09-09'), today, BOUNDS)).toBe(false);
    // Turns 66 tomorrow, so still 65 today and still eligible.
    expect(isWithinAgeBounds(day('1960-09-09'), today, BOUNDS)).toBe(true);
    // Turned 66 yesterday.
    expect(isWithinAgeBounds(day('1960-09-07'), today, BOUNDS)).toBe(false);
  });
});

describe('weight', () => {
  it('derives a figure from the band lower bound so the check is never skipped', () => {
    expect(WEIGHT_BANDS.map(weightKgFromBand)).toEqual([0, 45, 50, 60, 70]);
  });

  it('prefers an exact figure when the donor gave one', () => {
    expect(effectiveWeightKg('50_60', 58)).toBe(58);
    expect(effectiveWeightKg('50_60')).toBe(50);
    // Someone in the 50–60 band who says 47 is taken at their word.
    expect(effectiveWeightKg('50_60', 47)).toBe(47);
  });
});

describe('inter-donation interval (§5)', () => {
  it('rolls forward 90 days for men and 120 for women', () => {
    expect(nextEligibleOn(day('2026-06-01'), 'male', INTERVALS)).toBe('2026-08-30');
    expect(nextEligibleOn(day('2026-06-01'), 'female', INTERVALS)).toBe('2026-09-29');
  });

  it('applies the longer interval to donors who record their sex as other', () => {
    expect(nextEligibleOn(day('2026-06-01'), 'other', INTERVALS)).toBe(
      nextEligibleOn(day('2026-06-01'), 'female', INTERVALS),
    );
  });

  it('leaves a donor who has never donated immediately eligible', () => {
    expect(nextEligibleOn(undefined, 'male', INTERVALS)).toBeUndefined();
    expect(hasIntervalElapsed(undefined, day('2026-09-08'))).toBe(true);
    expect(daysUntilEligible(undefined, day('2026-09-08'))).toBe(0);
  });

  it('is eligible on the interval day itself, not the day after', () => {
    const next = nextEligibleOn(day('2026-06-01'), 'male', INTERVALS);
    expect(hasIntervalElapsed(next, day('2026-08-29'))).toBe(false);
    expect(hasIntervalElapsed(next, day('2026-08-30'))).toBe(true);
    expect(hasIntervalElapsed(next, day('2026-08-31'))).toBe(true);
  });

  it('reports the wait remaining, and never a negative one', () => {
    const next = nextEligibleOn(day('2026-06-01'), 'male', INTERVALS);
    expect(daysUntilEligible(next, day('2026-08-29'))).toBe(1);
    expect(daysUntilEligible(next, day('2026-08-30'))).toBe(0);
    expect(daysUntilEligible(next, day('2026-09-30'))).toBe(0);
  });

  it('crosses a year end', () => {
    expect(nextEligibleOn(day('2026-11-15'), 'female', INTERVALS)).toBe('2027-03-15');
  });
});

describe('qualifying a donor from their answers (§5)', () => {
  const THRESHOLDS = { minAge: 18, maxAge: 65, minWeightKg: 45 };
  const TODAY = day('2026-09-10');
  const at = (dob: string, weightKg = 60, flagged = false) =>
    qualifyDonor({ dob: day(dob), weightKg, flagged }, TODAY, THRESHOLDS);

  it('qualifies somebody whose answers raise nothing', () => {
    expect(at('1995-01-01')).toEqual({ status: 'qualified', reason: null });
  });

  it('is inclusive at both age bounds', () => {
    // Exactly 18 today, and exactly 65 today. Both qualify.
    expect(at('2008-09-10').status).toBe('qualified');
    expect(at('1961-09-10').status).toBe('qualified');
    // One day either side of each.
    expect(at('2008-09-11').status).toBe('not_qualified');
    expect(at('1960-09-10').status).toBe('not_qualified');
  });

  it('is inclusive at the weight threshold', () => {
    expect(at('1995-01-01', 45).status).toBe('qualified');
    expect(at('1995-01-01', 44).status).toBe('not_qualified');
  });

  it('puts a flagged health answer ahead of every threshold', () => {
    // Somebody who is both flagged and underweight hears about the flag, which
    // is the one a person can resolve today by looking at it.
    const result = at('1995-01-01', 40, true);
    expect(result.status).toBe('flagged');
    expect(result.reason).toContain('health');
  });

  it('tells somebody too young when to come back, not that they are rejected', () => {
    const result = at('2015-01-01');
    expect(result.reason).toContain('18');
    // §2.7 forbids the verdict words outright.
    for (const word of ['reject', 'ineligible', 'banned', 'eliminated']) {
      expect(result.reason?.toLowerCase()).not.toContain(word);
    }
  });

  it('names the threshold rather than judging the person', () => {
    const result = at('1995-01-01', 40);
    expect(result.reason).toContain('45 kg');
    expect(result.reason).toContain('safe for you');
  });

  it('says nothing about the donation window, which is a fact about today', () => {
    /*
      The window is deliberately absent: a stored judgement that included it
      would be written in June and wrong by September. `hasIntervalElapsed`
      answers that question live, every time a wave runs.
    */
    expect(at('1995-01-01').status).toBe('qualified');
  });
});
