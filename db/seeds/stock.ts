/**
 * Synthetic stock for the register (§4).
 *
 * "Seed before UI" is a standing rule of the build plan, and Module 2 needs it
 * more than Module 1 did: a decision screen with an empty fridge shows none of
 * the behaviour that matters, and a stock floor nothing is below cannot be
 * demonstrated at all.
 *
 * So the distribution is deliberately uneven. O+ and A+ sit above the floor of
 * 25; the four negative groups sit well below it, which is both what a real
 * Kerala centre looks like and what makes "recruit for groups below floor"
 * produce something the moment it is pressed.
 *
 * Every unit number is prefixed `SYN-` and every bag is fictional. No real
 * donation identifier enters this system at any point.
 */

import { addDays, dayOf, type BloodGroup, type Product } from '@blood-connect/domain';
import { newId } from '@blood-connect/ids';

/** Marks every seeded unit, so synthetic stock can never be mistaken for real. */
export const SYNTHETIC_UNIT_PREFIX = 'SYN-';

/** Matches the rows migration 0010 seeds into `product_shelf_lives`. */
const SHELF_LIFE_DAYS: Readonly<Record<Product, number>> = {
  whole_blood: 35,
  prbc: 42,
  platelet_concentrate: 5,
  ffp: 365,
  cryoprecipitate: 365,
};

/**
 * Red cells on the shelf, per group.
 *
 * Below the floor for six of the eight groups: a centre that is comfortable in
 * every group is not a centre that needs this system.
 */
const RED_CELL_STOCK: Readonly<Record<BloodGroup, number>> = {
  'O+': 30,
  'A+': 26,
  'B+': 22,
  'AB+': 6,
  'O-': 8,
  'A-': 4,
  'B-': 3,
  'AB-': 1,
};

/** A few components that can never recruit a donor, so the rule is visible. */
const COMPONENT_STOCK: readonly (readonly [BloodGroup, Product, number])[] = [
  ['O+', 'platelet_concentrate', 4],
  ['A+', 'platelet_concentrate', 3],
  ['B+', 'ffp', 5],
  ['O-', 'ffp', 2],
  ['AB+', 'cryoprecipitate', 2],
];

export type BagSeed = {
  readonly id: string;
  readonly unitNumber: string;
  readonly bloodGroup: BloodGroup;
  readonly product: Product;
  readonly collectedAt: string;
  readonly expiresAt: string;
  readonly source: string;
};

/**
 * Spread collection dates so expiries differ.
 *
 * The decision transaction claims oldest-expiry-first, and a shelf where every
 * bag expires on the same day demonstrates nothing about that. It would pass
 * whether the ORDER BY were there or not.
 */
export function buildStockSeed(now: Date = new Date()): BagSeed[] {
  const today = dayOf(now, 'Asia/Kolkata');
  const bags: BagSeed[] = [];
  let n = 0;

  const add = (bloodGroup: BloodGroup, product: Product, ageDays: number): void => {
    n += 1;
    const collectedAt = addDays(today, -ageDays);
    bags.push({
      id: newId(),
      unitNumber: `${SYNTHETIC_UNIT_PREFIX}${String(n).padStart(5, '0')}`,
      bloodGroup,
      product,
      collectedAt,
      expiresAt: addDays(collectedAt, SHELF_LIFE_DAYS[product]),
      source: 'Voluntary camp (synthetic)',
    });
  };

  for (const [group, count] of Object.entries(RED_CELL_STOCK) as [BloodGroup, number][]) {
    for (let i = 0; i < count; i += 1) {
      // Two thirds packed cells, which is what a hospital centre actually holds.
      const product: Product = i % 3 === 0 ? 'whole_blood' : 'prbc';
      add(group, product, (i * 3) % 25);
    }
  }

  for (const [group, product, count] of COMPONENT_STOCK) {
    for (let i = 0; i < count; i += 1) add(group, product, i);
  }

  return bags;
}
