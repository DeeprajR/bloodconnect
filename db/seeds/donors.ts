/**
 * A synthetic donor pool (§5, build plan prerequisites).
 *
 * Spread across the seeded Kozhikode hierarchy so **wave ordering is visible**
 * rather than theoretical: a demand raised for the centre's own locality must
 * visibly reach the nearest donors first, and a pool that all sits in one place
 * demonstrates nothing about that.
 *
 * Every one of these people is invented. Names are drawn from a fixed list of
 * common Malayalam given names combined with a synthetic marker, dates of birth
 * are generated, and every phone number is in the `+9199` test range with a
 * sequential suffix. **No real donor record enters this system at any point**,
 * including "just to test".
 */

import { addDays, dayOf, type BloodGroup, type Sex, type WeightBand } from '@blood-connect/domain';
import { newId } from '@blood-connect/ids';

/** Marks every seeded donor, so synthetic data can never pass for real. */
export const SYNTHETIC_DONOR_SUFFIX = '(seed)';

const GIVEN_NAMES = [
  'Anand', 'Bindu', 'Chandran', 'Deepa', 'Faisal', 'Geetha', 'Harish', 'Indira',
  'Jayan', 'Kavya', 'Lakshmi', 'Manoj', 'Nisha', 'Praveen', 'Rekha', 'Sajan',
  'Thomas', 'Usha', 'Vinod', 'Zainab',
] as const;

/**
 * Roughly the Indian distribution, which is what makes the negative groups
 * scarce enough for recruitment to matter: O+ and B+ dominate, and AB− is rare.
 */
const GROUP_WEIGHTS: readonly (readonly [BloodGroup, number])[] = [
  ['O+', 32],
  ['B+', 26],
  ['A+', 21],
  ['AB+', 8],
  ['O-', 5],
  ['B-', 4],
  ['A-', 3],
  ['AB-', 1],
];

export type DonorSeed = {
  readonly id: string;
  readonly name: string;
  readonly dob: string;
  readonly sex: Sex;
  readonly bloodGroup: BloodGroup;
  readonly weightBand: WeightBand;
  readonly weightKg: number;
  readonly districtId: string;
  readonly cityId: string | null;
  readonly townId: string | null;
  readonly localityId: string | null;
  readonly lastDonatedOn: string | null;
  readonly nextEligibleOn: string | null;
  readonly phone: string;
  readonly channelUserId: string;
};

/** Deterministic pseudo-randomness, so a re-seed produces the same pool. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

function pickGroup(random: () => number): BloodGroup {
  const total = GROUP_WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [group, weight] of GROUP_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return group;
  }
  return 'O+';
}

export type PlaceSeed = {
  readonly districtId: string;
  readonly cityId: string | null;
  readonly townId: string | null;
  readonly localityId: string | null;
};

const WEIGHT_BANDS_USABLE: readonly WeightBand[] = ['45_50', '50_60', '60_70', '70_plus'];
const WEIGHT_KG: Readonly<Record<string, number>> = {
  '45_50': 47,
  '50_60': 55,
  '60_70': 65,
  '70_plus': 78,
};

/**
 * Builds the pool.
 *
 * A third have donated recently and are **not** yet eligible, which is
 * deliberate: a pool where everybody can give proves nothing about the
 * inter-donation interval, and the interval is the rule most likely to be
 * quietly broken by a change.
 */
export function buildDonorSeed(
  places: readonly PlaceSeed[],
  count = 60,
  now: Date = new Date(),
): DonorSeed[] {
  if (places.length === 0) return [];

  const today = dayOf(now, 'Asia/Kolkata');
  const random = seededRandom(20260908);
  const donors: DonorSeed[] = [];

  for (let i = 0; i < count; i += 1) {
    const place = places[i % places.length];
    if (!place) continue;

    const given = GIVEN_NAMES[i % GIVEN_NAMES.length] ?? 'Synthetic';
    const sex: Sex = i % 3 === 0 ? 'female' : i % 7 === 0 ? 'other' : 'male';
    const band = WEIGHT_BANDS_USABLE[i % WEIGHT_BANDS_USABLE.length] ?? '60_70';

    // Ages spread across the eligible range, none at the boundary — the
    // boundaries are the test suite's business, not the demo dataset's.
    const age = 21 + Math.floor(random() * 40);
    const dob = addDays(today, -(age * 365 + Math.floor(random() * 300)));

    // A third are inside their interval and must not be selected.
    const donatedRecently = i % 3 === 0;
    const lastDonatedOn = donatedRecently
      ? addDays(today, -Math.floor(random() * 60))
      : i % 5 === 0
        ? addDays(today, -(200 + Math.floor(random() * 400)))
        : null;

    const intervalDays = sex === 'male' ? 90 : 120;
    const nextEligibleOn = lastDonatedOn ? addDays(lastDonatedOn, intervalDays) : null;

    donors.push({
      id: newId(),
      name: `${given} ${SYNTHETIC_DONOR_SUFFIX}`,
      dob,
      sex,
      bloodGroup: pickGroup(random),
      weightBand: band,
      weightKg: WEIGHT_KG[band] ?? 60,
      districtId: place.districtId,
      cityId: place.cityId,
      townId: place.townId,
      localityId: place.localityId,
      lastDonatedOn,
      nextEligibleOn,
      // RFC-style test numbers, sequential so they can never collide with a
      // real one and can never be dialled by accident.
      phone: `+9199000${String(10000 + i).slice(-5)}`,
      channelUserId: `seed-${String(100000 + i)}`,
    });
  }

  return donors;
}
