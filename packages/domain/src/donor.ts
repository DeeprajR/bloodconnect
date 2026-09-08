/**
 * Donor eligibility arithmetic (§5, §12).
 *
 * Every threshold here arrives as a parameter, never as a constant: age bounds,
 * minimum weight and the inter-donation interval are clinical configuration and
 * change by a database row, not a deploy (§12).
 *
 * This is one half of the predicate that necessarily exists twice — here as
 * TypeScript to check a single donor arriving on a deep link, and as SQL to
 * select a wave of twenty (§7.7). Both take their thresholds from the same
 * config object, and an agreement test asserts they never disagree.
 */

import { addDays, daysBetween, isSameOrAfter, type CalendarDay } from './time.js';

export const SEXES = ['female', 'male', 'other'] as const;
export type Sex = (typeof SEXES)[number];

const SEX_LABELS: Readonly<Record<Sex, string>> = {
  female: 'Female',
  male: 'Male',
  other: 'Other',
};
export const sexLabel = (sex: Sex): string => SEX_LABELS[sex];

/**
 * Weight is asked as a coarse band, with an optional exact figure (§5).
 *
 * `weight_kg` is derived from the band's **lower bound** when no exact figure is
 * given, so the threshold comparison is never skipped for being null — a donor
 * in the 45–50 band counts as 45, which is the conservative reading.
 */
export const WEIGHT_BANDS = ['under_45', '45_50', '50_60', '60_70', '70_plus'] as const;
export type WeightBand = (typeof WEIGHT_BANDS)[number];

const WEIGHT_BAND_LABELS: Readonly<Record<WeightBand, string>> = {
  under_45: 'Under 45',
  '45_50': '45–50',
  '50_60': '50–60',
  '60_70': '60–70',
  '70_plus': '70+ kg',
};
export const weightBandLabel = (band: WeightBand): string => WEIGHT_BAND_LABELS[band];

const WEIGHT_BAND_LOWER_BOUND: Readonly<Record<WeightBand, number>> = {
  under_45: 0,
  '45_50': 45,
  '50_60': 50,
  '60_70': 60,
  '70_plus': 70,
};

export const weightKgFromBand = (band: WeightBand): number => WEIGHT_BAND_LOWER_BOUND[band];

/** An exact figure always wins; the band is the floor used when there is none. */
export const effectiveWeightKg = (band: WeightBand, exactKg?: number): number =>
  exactKg ?? weightKgFromBand(band);

/* -------------------------------------------------------------------------- */
/* Age                                                                         */
/* -------------------------------------------------------------------------- */

/** Completed years on `today`. Birthday not yet reached this year → one less. */
export function ageOn(dateOfBirth: CalendarDay, today: CalendarDay): number {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  const hadBirthday = tm > bm || (tm === bm && td >= bd);
  return ty - by - (hadBirthday ? 0 : 1);
}

export type AgeBounds = { readonly minYears: number; readonly maxYears: number };

/** Inclusive at both ends: exactly 18 and exactly 65 are both eligible (§7.7). */
export const isWithinAgeBounds = (
  dateOfBirth: CalendarDay,
  today: CalendarDay,
  bounds: AgeBounds,
): boolean => {
  const age = ageOn(dateOfBirth, today);
  return age >= bounds.minYears && age <= bounds.maxYears;
};

/* -------------------------------------------------------------------------- */
/* Inter-donation interval                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Days that must pass after a donation before the next one, by sex (§5).
 *
 * National guideline values are 90 days for men and 120 for women. `other` is
 * not addressed by the guideline; this system applies the longer of the two,
 * which is the safe direction, and open question #1 puts the wording in front of
 * the centre. Never shorten it to make a demo work.
 */
export type DonationIntervals = Readonly<Record<Sex, number>>;

export function intervalDaysFor(sex: Sex, intervals: DonationIntervals): number {
  return intervals[sex];
}

/**
 * The day a donor becomes eligible again. Stored on the donor row and recomputed
 * on every change (§5.7) — a wave query cannot compute an interval per row
 * across a large pool, so this value is denormalised and indexed.
 *
 * A donor who has never donated is eligible immediately, which is `undefined`
 * here and `NULL` in the column.
 */
export function nextEligibleOn(
  lastDonatedOn: CalendarDay | undefined,
  sex: Sex,
  intervals: DonationIntervals,
): CalendarDay | undefined {
  if (lastDonatedOn === undefined) return undefined;
  return addDays(lastDonatedOn, intervalDaysFor(sex, intervals));
}

/** Eligible on the interval day itself, not the day after (§7.7's boundary). */
export const hasIntervalElapsed = (
  nextEligible: CalendarDay | undefined,
  today: CalendarDay,
): boolean => nextEligible === undefined || isSameOrAfter(today, nextEligible);

/** 0 once eligible; otherwise how many days are left to wait. */
export const daysUntilEligible = (
  nextEligible: CalendarDay | undefined,
  today: CalendarDay,
): number => {
  if (nextEligible === undefined) return 0;
  return Math.max(0, daysBetween(today, nextEligible));
};
