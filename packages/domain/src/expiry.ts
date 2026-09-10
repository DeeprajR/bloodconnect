/**
 * Expiry arithmetic (§4).
 *
 * A bag's expiry is derived at intake from the collection day and the product's
 * configured shelf life, or taken from the label when the label carries one.
 * Which of the two was used is recorded, because "the label said so" and "we
 * calculated it" are different claims when a unit is questioned later.
 *
 * A return **never** recalculates expiry. That rule lives in the use case and is
 * asserted by a test; this file simply offers no function that could do it.
 */

import type { Product } from './blood.js';
import { addDays, compareDays, daysBetween, isAfter, type CalendarDay } from './time.js';

export const EXPIRY_SOURCES = ['derived', 'label'] as const;
export type ExpirySource = (typeof EXPIRY_SOURCES)[number];

/** Shelf life in whole days per component, held as configuration (§12). */
export type ShelfLives = Readonly<Record<Product, number>>;

/**
 * Expiry from collection. A unit collected on the 28th with a 35-day shelf life
 * expires on the following month's 4th. Month ends and leap days are the
 * arithmetic this has to survive (§17).
 */
export function deriveExpiry(collectedOn: CalendarDay, shelfLifeDays: number): CalendarDay {
  if (!Number.isInteger(shelfLifeDays) || shelfLifeDays < 0) {
    throw new Error(`shelf life must be a whole number of days: ${shelfLifeDays}`);
  }
  return addDays(collectedOn, shelfLifeDays);
}

export const deriveExpiryForProduct = (
  collectedOn: CalendarDay,
  product: Product,
  shelfLives: ShelfLives,
): CalendarDay => deriveExpiry(collectedOn, shelfLives[product]);

/**
 * A unit is usable through the whole of its expiry day and expired the day
 * after. The day/instant boundary of §5.2, applied to stock.
 */
export const isExpiredOn = (expiresAt: CalendarDay, today: CalendarDay): boolean =>
  isAfter(today, expiresAt);

/** Negative once the unit has expired, so a caller can show "3 days overdue". */
export const daysUntilExpiry = (expiresAt: CalendarDay, today: CalendarDay): number =>
  daysBetween(today, expiresAt);

/**
 * Oldest expiry first. The order the decision transaction claims bags in
 * (§7.2), so the shortest-dated unit is always the one issued.
 */
export const byOldestExpiryFirst = (
  a: { readonly expiresAt: CalendarDay },
  b: { readonly expiresAt: CalendarDay },
): -1 | 0 | 1 => compareDays(a.expiresAt, b.expiresAt);
