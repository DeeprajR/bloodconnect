import { describe, expect, it } from 'vitest';

import { BLOOD_GROUPS } from './blood.js';
import {
  STOCK_BANDS,
  STOCK_DISPLAY_ORDER,
  stockBandFor,
  stockFillFraction,
  type StockBand,
} from './stock.js';

/**
 * The shipped default for `stock.critical_fraction`, written out rather than
 * imported: this package may not depend on `@blood-connect/config` (§12, and
 * the `domain-is-pure` boundary rule). A test that reached for the config
 * package would also stop proving that the threshold arrives as a parameter.
 */
const critical = 0.4;
const band = (onShelf: number, floor = 25): StockBand =>
  stockBandFor(onShelf, floor, critical);

describe('the stock bands (§4)', () => {
  /**
   * The prototype the centre approved, read back as assertions.
   *
   * 25/25 green, 10/25 orange, 6/25 red — three points that pin the boundary
   * between low and critical to somewhere in (0.24, 0.40].
   */
  it('matches the three counts on the approved chart', () => {
    expect(band(25)).toBe('adequate');
    expect(band(10)).toBe('low');
    expect(band(6)).toBe('critical');
  });

  it('calls the floor itself adequate, and one short of it low', () => {
    // The floor is the definition of enough, so the boundary is inclusive.
    expect(band(25)).toBe('adequate');
    expect(band(24)).toBe('low');
  });

  it('does not stop being adequate above the floor', () => {
    expect(band(26)).toBe('adequate');
    expect(band(1000)).toBe('adequate');
  });

  it('separates an empty shelf from a low one', () => {
    /**
     * The distinction the fourth colour exists for. Below the floor raises a
     * demand; nothing at all means the next request for this group cannot be
     * answered from stock, and a screen showing both the same hides that.
     */
    expect(band(1)).toBe('critical');
    expect(band(0)).toBe('empty');
  });

  it('reports an empty shelf even when no floor is set', () => {
    expect(band(0, 0)).toBe('empty');
  });

  it('does not paint a centre with no floor red on day one', () => {
    // Nothing has been configured to be short of, so nothing is short.
    expect(band(1, 0)).toBe('adequate');
    expect(band(1, -5)).toBe('adequate');
  });

  it('reads the boundary from the fraction it is given, not from a constant', () => {
    // Half the floor: 12 of 25 is now the critical side of the line, and the
    // default's answer for the same count is not.
    expect(stockBandFor(12, 25, 0.5)).toBe('critical');
    expect(stockBandFor(12, 25, 0.4)).toBe('low');
  });

  it('puts the boundary itself on the low side', () => {
    // 10 of 25 is exactly two fifths, and the chart shows it orange.
    expect(stockBandFor(10, 25, 0.4)).toBe('low');
    expect(stockBandFor(9, 25, 0.4)).toBe('critical');
  });

  it('survives a fraction outside its range without losing a band', () => {
    // Config validates this at the boundary; the clamp is here so a bad value
    // cannot silently collapse `low` into `critical` or the reverse.
    expect(stockBandFor(24, 25, 5)).toBe('critical');
    expect(stockBandFor(1, 25, -1)).toBe('low');
  });

  it('treats a nonsense count as nothing on the shelf', () => {
    expect(band(Number.NaN)).toBe('empty');
    expect(band(-3)).toBe('empty');
  });

  it('answers with a known band for every count', () => {
    // Total by construction: a count that fell through would reach the chart
    // with no colour class and render as an unlabelled grey bar.
    for (let units = 0; units <= 60; units += 1) {
      expect(STOCK_BANDS).toContain(band(units));
    }
  });
});

describe('how much of the bar is filled', () => {
  it('fills in proportion to the floor', () => {
    expect(stockFillFraction(25, 25)).toBe(1);
    expect(stockFillFraction(10, 25)).toBe(0.4);
    expect(stockFillFraction(0, 25)).toBe(0);
  });

  it('caps a surplus at full', () => {
    // Twice the floor is full, not overflowing. The count is printed on the
    // bar, so the surplus stays legible without the bar lying about it.
    expect(stockFillFraction(50, 25)).toBe(1);
  });

  it('handles a centre with no floor set', () => {
    expect(stockFillFraction(4, 0)).toBe(1);
    expect(stockFillFraction(0, 0)).toBe(0);
  });

  it('never returns something a CSS height cannot use', () => {
    for (const [onShelf, floor] of [
      [Number.NaN, 25],
      [-4, 25],
      [5, Number.NaN],
      [5, -25],
    ] as const) {
      const fraction = stockFillFraction(onShelf, floor);
      expect(Number.isFinite(fraction)).toBe(true);
      expect(fraction).toBeGreaterThanOrEqual(0);
      expect(fraction).toBeLessThanOrEqual(1);
    }
  });
});

describe('the order the groups are shown in', () => {
  it('is the clinical convention, not the storage one', () => {
    // A, B, AB, O — positive before negative, as the approved chart shows.
    expect([...STOCK_DISPLAY_ORDER]).toEqual([
      'A+',
      'A-',
      'B+',
      'B-',
      'AB+',
      'AB-',
      'O+',
      'O-',
    ]);
  });

  it('shows every group exactly once', () => {
    /**
     * The assertion that matters. A group missing from this list is a group
     * whose bar never appears, and nobody notices it has run out — the failure
     * being reordered introduces, and the only reason a second list of the
     * eight groups is tolerable at all.
     */
    expect([...STOCK_DISPLAY_ORDER].sort()).toEqual([...BLOOD_GROUPS].sort());
    expect(new Set(STOCK_DISPLAY_ORDER).size).toBe(BLOOD_GROUPS.length);
  });
});
