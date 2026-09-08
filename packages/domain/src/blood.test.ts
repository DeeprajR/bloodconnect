import { describe, expect, it } from 'vitest';

import {
  BLOOD_GROUPS,
  PRODUCTS,
  bloodGroupLabel,
  canDonateRedCellsTo,
  compatibleDonorGroupsFor,
  compatibleRecipientGroupsFor,
  donorGroupsFor,
  parseBloodGroup,
  productLabel,
  recruitsDonors,
  type BloodGroup,
} from './blood.js';

/**
 * The full 8×8 matrix, written out rather than derived.
 *
 * A test that computes the expected answer with the same rule as the code under
 * test proves only that the rule is consistent with itself. This table is the
 * standard red-cell compatibility table, and it is the one thing in this
 * repository that a clinician can check line by line without reading any code.
 *
 * Read as: a patient of `group` may receive red cells from these donor groups.
 */
const RECEIVES_FROM: Readonly<Record<BloodGroup, readonly BloodGroup[]>> = {
  'O-': ['O-'],
  'O+': ['O-', 'O+'],
  'A-': ['O-', 'A-'],
  'A+': ['O-', 'O+', 'A-', 'A+'],
  'B-': ['O-', 'B-'],
  'B+': ['O-', 'O+', 'B-', 'B+'],
  'AB-': ['O-', 'A-', 'B-', 'AB-'],
  'AB+': ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
};

describe('ABO/Rh red-cell compatibility', () => {
  it('covers all sixty-four donor/recipient pairs', () => {
    const pairs = BLOOD_GROUPS.flatMap((donor) =>
      BLOOD_GROUPS.map((recipient) => [donor, recipient] as const),
    );
    expect(pairs).toHaveLength(64);

    for (const [donor, recipient] of pairs) {
      const expected = RECEIVES_FROM[recipient].includes(donor);
      expect(
        canDonateRedCellsTo(donor, recipient),
        `${donor} → ${recipient} should be ${expected ? 'compatible' : 'incompatible'}`,
      ).toBe(expected);
    }
  });

  it('makes O− the universal red-cell donor', () => {
    expect(compatibleRecipientGroupsFor('O-')).toEqual([...BLOOD_GROUPS]);
  });

  it('makes AB+ the universal red-cell recipient', () => {
    expect(compatibleDonorGroupsFor('AB+')).toEqual([...BLOOD_GROUPS]);
  });

  it('leaves O− patients able to receive from O− only', () => {
    expect(compatibleDonorGroupsFor('O-')).toEqual(['O-']);
  });

  it('never lets an RhD-positive unit reach an RhD-negative patient', () => {
    for (const donor of BLOOD_GROUPS.filter((g) => g.endsWith('+'))) {
      for (const recipient of BLOOD_GROUPS.filter((g) => g.endsWith('-'))) {
        expect(canDonateRedCellsTo(donor, recipient)).toBe(false);
      }
    }
  });

  it('is reflexive — every group can receive from itself', () => {
    for (const group of BLOOD_GROUPS) {
      expect(canDonateRedCellsTo(group, group)).toBe(true);
    }
  });

  it('narrows to a single group when the centre requires an exact match', () => {
    expect(donorGroupsFor('A+', 'exact')).toEqual(['A+']);
    expect(donorGroupsFor('A+', 'compatible')).toEqual(['O-', 'O+', 'A-', 'A+']);
  });
});

describe('blood group parsing and labels', () => {
  it('accepts the display minus sign and stores the ASCII form', () => {
    expect(parseBloodGroup('A−')).toBe('A-');
    expect(parseBloodGroup('ab−')).toBe('AB-');
    expect(parseBloodGroup(' o+ ')).toBe('O+');
  });

  it('rejects anything that is not one of the eight', () => {
    expect(parseBloodGroup('C+')).toBeUndefined();
    expect(parseBloodGroup('A')).toBeUndefined();
    expect(parseBloodGroup('')).toBeUndefined();
    expect(parseBloodGroup(null)).toBeUndefined();
  });

  it('labels negatives with a minus sign, not a hyphen (§2.7)', () => {
    // Pinning the exact codepoint: the wording regression test in §2.7 is about
    // the strings people read, and U+2212 is what the spec writes.
    expect(bloodGroupLabel('A-')).toBe('A−');
    expect(bloodGroupLabel('AB-')).toBe('AB−');
    expect(bloodGroupLabel('O+')).toBe('O+');
  });
});

describe('components (§2.7)', () => {
  it('uses the standard component names verbatim', () => {
    expect(PRODUCTS.map(productLabel)).toEqual([
      'Whole Blood',
      'Packed Red Blood Cells (PRBC)',
      'Platelet Concentrate (RDP / SDP)',
      'Fresh Frozen Plasma (FFP)',
      'Cryoprecipitate',
    ]);
  });

  it('recruits donors for whole blood and packed red cells only (§4)', () => {
    expect(PRODUCTS.filter(recruitsDonors)).toEqual(['whole_blood', 'prbc']);
    // Platelets, plasma and cryoprecipitate are separated in a lab; a shortfall
    // in them must never raise demand, and the checkbox is disabled from here.
    expect(recruitsDonors('platelet_concentrate')).toBe(false);
    expect(recruitsDonors('ffp')).toBe(false);
    expect(recruitsDonors('cryoprecipitate')).toBe(false);
  });
});
