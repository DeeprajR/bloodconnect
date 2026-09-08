import { describe, expect, it } from 'vitest';

import {
  MAX_REQUEST_SEQUENCE,
  formatRequestNumber,
  isRequestNumber,
  parseRequestNumber,
} from './request-id.js';

describe('BR-YYYY-NNNNNN (§3)', () => {
  it('pads the sequence to six digits', () => {
    expect(formatRequestNumber(2026, 1)).toBe('BR-2026-000001');
    expect(formatRequestNumber(2026, 142)).toBe('BR-2026-000142');
    expect(formatRequestNumber(2026, 999_999)).toBe('BR-2026-999999');
  });

  it('round-trips', () => {
    const formatted = formatRequestNumber(2026, 142);
    expect(parseRequestNumber(formatted)).toEqual({ year: 2026, sequence: 142 });
  });

  it('refuses to wrap when the year runs out of room', () => {
    // Wrapping would mint an identifier that already belongs to a request.
    expect(() => formatRequestNumber(2026, MAX_REQUEST_SEQUENCE + 1)).toThrow();
    expect(() => formatRequestNumber(2026, 0)).toThrow();
    expect(() => formatRequestNumber(2026, 1.5)).toThrow();
  });

  it('rejects anything that is not the format', () => {
    for (const value of ['BR-2026-142', 'BR-26-000142', '2026-000142', 'BR-2026-000000', '']) {
      expect(parseRequestNumber(value), value).toBeUndefined();
    }
    expect(isRequestNumber('BR-2026-000142')).toBe(true);
  });

  it('is forgiving about case and surrounding space at the edge', () => {
    expect(parseRequestNumber(' br-2026-000142 ')).toEqual({ year: 2026, sequence: 142 });
  });
});
