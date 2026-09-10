/**
 * Blood groups, components, and the ABO/Rh compatibility matrix (§2.7, §5).
 *
 * Pure: no clock, no I/O, no configuration. This file is the only place in the
 * system where "who can give to whom" is decided, because the spec requires one
 * implementation of the clinical rules shared by the web app and the bot (§11.3).
 *
 * Two directions are deliberately kept apart:
 *
 *  - **Issuing from stock is an exact group match.** The decision transaction
 *    (§7.2) selects bags `WHERE blood_group = $group`, so no compatibility
 *    lookup happens at the counter. Substituting a compatible group is a
 *    clinical decision a human makes, not one this system takes silently.
 *  - **Recruiting donors uses the red-cell matrix.** A wave is selected on
 *    `blood_group = ANY(compatibleDonorGroupsFor(need))` (§7.7), and demand is
 *    only ever raised for whole blood or packed red cells (§4), so the red-cell
 *    direction is the only one recruitment can ask for.
 */

/** Stored value. ASCII, because it is a database enum and a URL parameter. */
export const BLOOD_GROUPS = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

export type AboGroup = 'O' | 'A' | 'B' | 'AB';
export type RhD = 'positive' | 'negative';

/**
 * Display label. Uses U+2212 MINUS SIGN, not a hyphen: §2.7 writes the groups as
 * A+, A−, B+, B−, AB+, AB−, O+, O−, and the wording regression test pins it.
 */
const GROUP_LABELS: Readonly<Record<BloodGroup, string>> = {
  'O-': 'O−',
  'O+': 'O+',
  'A-': 'A−',
  'A+': 'A+',
  'B-': 'B−',
  'B+': 'B+',
  'AB-': 'AB−',
  'AB+': 'AB+',
};

export const bloodGroupLabel = (group: BloodGroup): string => GROUP_LABELS[group];

export const isBloodGroup = (value: unknown): value is BloodGroup =>
  typeof value === 'string' && (BLOOD_GROUPS as readonly string[]).includes(value);

export function parseBloodGroup(value: unknown): BloodGroup | undefined {
  if (typeof value !== 'string') return undefined;
  // Accept the display minus sign on the way in; store the ASCII form.
  const normalised = value.trim().toUpperCase().replace(/−|–|:/g, '-');
  return isBloodGroup(normalised) ? normalised : undefined;
}

export const aboOf = (group: BloodGroup): AboGroup =>
  group.slice(0, group.length - 1) as AboGroup;

export const rhOf = (group: BloodGroup): RhD =>
  group.endsWith('+') ? 'positive' : 'negative';

/** A-and-B antigens carried on the donor's red cells. */
const ABO_ANTIGENS: Readonly<Record<AboGroup, readonly ('A' | 'B')[]>> = {
  O: [],
  A: ['A'],
  B: ['B'],
  AB: ['A', 'B'],
};

/**
 * Red-cell compatibility: may a unit from `donor` be transfused to `recipient`?
 *
 * ABO. The donor's antigens must be a subset of the recipient's, so the
 * recipient has no antibody against them. Rh. RhD-negative units go to anyone;
 * RhD-positive units only to RhD-positive recipients.
 */
export function canDonateRedCellsTo(donor: BloodGroup, recipient: BloodGroup): boolean {
  const donorAntigens = ABO_ANTIGENS[aboOf(donor)];
  const recipientAntigens = ABO_ANTIGENS[aboOf(recipient)];
  const aboCompatible = donorAntigens.every((a) => recipientAntigens.includes(a));
  const rhCompatible = rhOf(donor) === 'negative' || rhOf(recipient) === 'positive';
  return aboCompatible && rhCompatible;
}

/** The groups a wave may be drawn from for a patient of `recipient` (§7.7). */
export function compatibleDonorGroupsFor(recipient: BloodGroup): BloodGroup[] {
  return BLOOD_GROUPS.filter((donor) => canDonateRedCellsTo(donor, recipient));
}

/** The patients a unit of `donor` could serve. Used by stock pressure views. */
export function compatibleRecipientGroupsFor(donor: BloodGroup): BloodGroup[] {
  return BLOOD_GROUPS.filter((recipient) => canDonateRedCellsTo(donor, recipient));
}

/**
 * Some centres require an exact group match rather than a compatible one (§5).
 * That is configuration, so the caller passes the policy rather than this file
 * knowing which centre it is running for.
 */
export type MatchPolicy = 'compatible' | 'exact';

export function donorGroupsFor(recipient: BloodGroup, policy: MatchPolicy): BloodGroup[] {
  return policy === 'exact' ? [recipient] : compatibleDonorGroupsFor(recipient);
}

/* -------------------------------------------------------------------------- */
/* Components                                                                  */
/* -------------------------------------------------------------------------- */

export const PRODUCTS = [
  'whole_blood',
  'prbc',
  'platelet_concentrate',
  'ffp',
  'cryoprecipitate',
] as const;
export type Product = (typeof PRODUCTS)[number];

/**
 * Standard component names (§2.7). The regression test pins these strings; they
 * are not adjusted for brevity in a UI. Open question #1 in the architecture
 * plan asks the centre to confirm this list against its own catalogue.
 */
const PRODUCT_LABELS: Readonly<Record<Product, string>> = {
  whole_blood: 'Whole Blood',
  prbc: 'Packed Red Blood Cells (PRBC)',
  platelet_concentrate: 'Platelet Concentrate (RDP / SDP)',
  ffp: 'Fresh Frozen Plasma (FFP)',
  cryoprecipitate: 'Cryoprecipitate',
};

export const productLabel = (product: Product): string => PRODUCT_LABELS[product];

export const isProduct = (value: unknown): value is Product =>
  typeof value === 'string' && (PRODUCTS as readonly string[]).includes(value);

/**
 * Only whole blood and packed red cells recruit donors (§4, §6).
 *
 * Platelets, plasma and cryoprecipitate are separated from a donation in a lab;
 * they are not what a walk-in donor produces on the day, so a shortfall in them
 * must never raise demand. The centre screen disables the checkbox, and this is
 * the rule it disables it from.
 */
export const recruitsDonors = (product: Product): boolean =>
  product === 'whole_blood' || product === 'prbc';
