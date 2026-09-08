import { describe, expect, it } from 'vitest';

import { FORBIDDEN_TERMS, WORDING } from './wording.js';
import { PRODUCTS, bloodGroupLabel, productLabel } from './blood.js';

/**
 * The §2.7 wording regression.
 *
 * Written now, while the labels are being typed for the first time, because
 * this is the test that is worthless if it is written later — by then the
 * strings it would pin are whatever they drifted to.
 */
describe('clinical vocabulary (§2.7)', () => {
  it('says blood centre, never blood bank', () => {
    // The term Indian regulation replaced in 2020. "Blood bank" remains the
    // colloquial equivalent, which is exactly why it creeps back in.
    expect(WORDING.bloodCentre).toBe('Blood centre');
  });

  it('names the crossmatch sample in full', () => {
    expect(WORDING.crossmatchSample).toBe(
      'Pre-transfusion compatibility testing sample',
    );
  });

  it('says indication for transfusion, not reason', () => {
    expect(WORDING.indication).toBe('Indication for transfusion');
  });

  it('says date required for staff, and needed by for donors', () => {
    // Plain language is right for donors and precision is right for the ward.
    // Both, deliberately, rather than one compromise for everyone.
    expect(WORDING.dateRequired).toBe('Date required');
    expect(WORDING.neededBy).toBe('Needed by');
  });

  it('calls a deferral a deferral', () => {
    // Accurate, temporary by default, and it does not read as a judgement of
    // the person.
    expect(WORDING.deferral).toBe('Deferral');
  });

  it('says inter-donation interval, not cooldown', () => {
    expect(WORDING.interDonationInterval).toBe('Inter-donation interval');
  });

  it('records the group as ABO and RhD, not Rh factor', () => {
    expect(WORDING.bloodGroupAndRh).toBe('ABO group and RhD type');
  });

  it('uses the standard component names verbatim', () => {
    expect(PRODUCTS.map(productLabel)).toEqual([
      'Whole Blood',
      'Packed Red Blood Cells (PRBC)',
      'Platelet Concentrate (RDP / SDP)',
      'Fresh Frozen Plasma (FFP)',
      'Cryoprecipitate',
    ]);
  });

  it('writes a negative group with a minus sign', () => {
    expect(bloodGroupLabel('AB-')).toBe('AB−');
  });

  it('contains none of the terms the spec rules out', () => {
    const vocabulary = [
      ...Object.values(WORDING),
      ...PRODUCTS.map(productLabel),
    ].map((term) => term.toLowerCase());

    for (const forbidden of Object.keys(FORBIDDEN_TERMS)) {
      const offenders = vocabulary.filter((term) => term.includes(forbidden));
      expect(offenders, `"${forbidden}" should not appear in any label`).toEqual([]);
    }
  });

  it('offers a replacement for every term it forbids', () => {
    // A rule that says "not that" without saying "this instead" gets ignored.
    for (const [forbidden, replacement] of Object.entries(FORBIDDEN_TERMS)) {
      expect(replacement.length, forbidden).toBeGreaterThan(0);
      expect(replacement.toLowerCase()).not.toContain(forbidden);
    }
  });
});
