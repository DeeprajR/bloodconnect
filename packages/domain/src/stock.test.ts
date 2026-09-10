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
 * The shipped defaults for `stock.low_fraction` and `stock.critical_fraction`,
 * written out rather than imported: this package may not depend on
 * `@blood-connect/config` (§12, and the `domain-is-pure` boundary rule). A test
 * that reached for the config package would also stop proving that the
 * thresholds arrive as parameters.
 */
const DEFAULTS = { low: 0.6, critical: 0.3 };
const band = (onShelf: number, floor = 25): StockBand =>
  stockBandFor(onShelf, floor, DEFAULTS);

describe('the stock bands (§4)', () => {
  /**
   * The prototype the centre approved, read back as assertions.
   *
   * 25/25 green, 10/25 orange, 6/25 red, three points that pin the boundary
   * between low and critical to somewhere in (0.24, 0.40].
   */
  it('grades a floor of 25 the way the centre reads it', () => {
    // Watch it · recruit · recruit tonight, and the two ends.
    expect(band(25)).toBe('adequate');
    expect(band(15)).toBe('low');
    expect(band(10)).toBe('short');
    expect(band(6)).toBe('critical');
    expect(band(0)).toBe('empty');
  });

  /**
   * The counts that prompted the five-colour scale.
   *
   * 1, 3 and 6 of 25 are all critical and share a colour, truthfully. They are
   * the same call to action. What distinguishes them on screen is bar height and
   * the printed count, which is why the fill is proportional with no minimum
   * height worth speaking of.
   */
  it('keeps the bottom three counts in one band, and says so', () => {
    expect(band(1)).toBe('critical');
    expect(band(3)).toBe('critical');
    expect(band(6)).toBe('critical');
    expect(stockFillFraction(1, 25)).toBeLessThan(stockFillFraction(3, 25));
    expect(stockFillFraction(3, 25)).toBeLessThan(stockFillFraction(6, 25));
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

  it('separates an empty shelf from a critical one', () => {
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

  it('reads both boundaries from the fractions it is given', () => {
    // The same count, three different centres' opinions about it.
    expect(stockBandFor(12, 25, { low: 0.6, critical: 0.3 })).toBe('short');
    expect(stockBandFor(12, 25, { low: 0.4, critical: 0.3 })).toBe('low');
    expect(stockBandFor(12, 25, { low: 0.8, critical: 0.6 })).toBe('critical');
  });

  it('puts each boundary itself on the kinder side', () => {
    // At the line is the better band; below it is the worse one.
    expect(stockBandFor(15, 25, DEFAULTS)).toBe('low');
    expect(stockBandFor(14, 25, DEFAULTS)).toBe('short');
    expect(stockBandFor(8, 25, DEFAULTS)).toBe('short');
    expect(stockBandFor(7, 25, DEFAULTS)).toBe('critical');
  });

  it('survives fractions outside their range without losing a band', () => {
    // Config validates these at the boundary; the clamp is here so a bad row
    // cannot silently collapse one band into another.
    expect(stockBandFor(24, 25, { low: 5, critical: 5 })).toBe('critical');
    expect(stockBandFor(1, 25, { low: -1, critical: -1 })).toBe('low');
  });

  it('does not let a crossed-over pair swallow the middle band', () => {
    /**
     * `critical` above `low` is a misconfiguration that would otherwise make
     * `short` unreachable and quietly change what every orange bar means. The
     * lower of the two always wins as the lower edge.
     */
    const crossed = { low: 0.3, critical: 0.6 };
    expect(stockBandFor(10, 25, crossed)).toBe('low');
    expect(stockBandFor(5, 25, crossed)).toBe('critical');
    expect(STOCK_BANDS).toContain(stockBandFor(8, 25, crossed));
  });

  it('treats a nonsense count as nothing on the shelf', () => {
    expect(band(Number.NaN)).toBe('empty');
    expect(band(-3)).toBe('empty');
  });

  it('uses every band on a floor of 25', () => {
    // A band no count can reach is a colour in the legend that never appears.
    const reached = new Set(Array.from({ length: 61 }, (_, units) => band(units)));
    expect([...reached].sort()).toEqual([...STOCK_BANDS].sort());
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
    // A, B, AB, O. Positive before negative, as the approved chart shows.
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
     * whose bar never appears, and nobody notices it has run out. The failure
     * being reordered introduces, and the only reason a second list of the
     * eight groups is tolerable at all.
     */
    expect([...STOCK_DISPLAY_ORDER].sort()).toEqual([...BLOOD_GROUPS].sort());
    expect(new Set(STOCK_DISPLAY_ORDER).size).toBe(BLOOD_GROUPS.length);
  });
});
