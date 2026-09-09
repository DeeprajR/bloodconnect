/**
 * How full a shelf is, as four states rather than a number (§4).
 *
 * The centre's overview shows one bar per blood group against the stock floor.
 * A bar's colour is the fastest thing on the screen to read, so what it means
 * has to be a rule rather than a judgement made in a component: the same count
 * must produce the same colour on every surface that ever shows one.
 *
 * Four states, and the two outer boundaries are structural rather than tunable:
 *
 * | State      | When                          | Why it is its own state |
 * |------------|-------------------------------|-------------------------|
 * | `adequate` | at or above the floor         | The floor is the definition of enough |
 * | `low`      | below the floor               | Recruitment should start; nothing is blocked yet |
 * | `critical` | below a share of the floor    | A bad night, not a bad week |
 * | `empty`    | nothing on the shelf          | **Not the same as low.** There is nothing to issue |
 *
 * `empty` is separated deliberately. "Below the floor" and "there is none"
 * differ in what happens next: one raises a demand, the other means the next
 * request for that group cannot be answered from stock at all, and a screen
 * that renders both as the same red hides that from the person who would act on
 * it.
 *
 * Per §12, this reads no configuration. The one tunable boundary arrives as a
 * parameter, from `stock.critical_fraction`.
 */

import type { BloodGroup } from './blood.js';

/**
 * The order the groups are shown in, which is not the order they are stored in.
 *
 * `BLOOD_GROUPS` is ordered for iteration and for the compatibility tables (§2).
 * A counter reads a shelf in the clinical convention — A, B, AB, O, positive
 * before negative — and that is what the approved chart shows. A screen that
 * lists them the storage way makes somebody hunt for the row they want.
 *
 * A test asserts this is a permutation of `BLOOD_GROUPS`: a group silently
 * missing from a stock chart is a group nobody notices has run out.
 */
export const STOCK_DISPLAY_ORDER = [
  'A+',
  'A-',
  'B+',
  'B-',
  'AB+',
  'AB-',
  'O+',
  'O-',
] as const satisfies readonly BloodGroup[];

export const STOCK_BANDS = ['adequate', 'low', 'critical', 'empty'] as const;
export type StockBand = (typeof STOCK_BANDS)[number];

/**
 * What each band is called on screen (§2.7).
 *
 * Written as statements about the shelf, not as severity words: "Critical" on
 * its own tells a counter nothing about what to do, and "Danger" is the
 * vocabulary of an alarm rather than of an inventory.
 */
export const STOCK_BAND_LABELS: Readonly<Record<StockBand, string>> = {
  adequate: 'At or above the floor',
  low: 'Below the floor',
  critical: 'Critically low',
  empty: 'None on the shelf',
};

/** Non-finite and negative inputs collapse to zero rather than to NaN. */
const atLeastZero = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : 0;

/**
 * The band for one group.
 *
 * @param onShelf units available now — reserved units are somebody else's
 *   already, so the caller excludes them (`stockByGroup`)
 * @param floor `centre_settings.min_units_per_group`, per centre and editable
 * @param criticalFraction `stock.critical_fraction`, the one tunable boundary
 */
export function stockBandFor(
  onShelf: number,
  floor: number,
  criticalFraction: number,
): StockBand {
  const units = atLeastZero(onShelf);

  // Nothing there is the same answer whatever the floor is, so it is decided
  // before the floor is consulted at all.
  if (units === 0) return 'empty';

  const target = atLeastZero(floor);
  // A centre that has not set a floor has told us nothing to be short of.
  // Inventing one here would paint the whole screen red on day one.
  if (target === 0) return 'adequate';

  if (units >= target) return 'adequate';

  // Clamped rather than trusted: config is validated at the boundary, and a
  // fraction outside (0, 1] here would silently swallow the `low` band.
  const boundary = Math.min(Math.max(criticalFraction, 0), 1);
  return units < target * boundary ? 'critical' : 'low';
}

/**
 * How much of the bar is filled, from 0 to 1.
 *
 * Capped at 1: a group at twice the floor is full, not overflowing. The count
 * is printed on the bar, so the surplus is legible without the bar having to
 * lie about its own height.
 */
export function stockFillFraction(onShelf: number, floor: number): number {
  const units = atLeastZero(onShelf);
  const target = atLeastZero(floor);

  if (target === 0) return units > 0 ? 1 : 0;
  return Math.min(1, units / target);
}
