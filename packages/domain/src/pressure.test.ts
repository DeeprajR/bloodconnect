import { describe, expect, it } from 'vitest';

import {
  PRESSURE_LABELS,
  PRESSURE_LEVELS,
  pressureFor,
  shareMessageFor,
  unitsOutstanding,
} from './pressure.js';

const FRACTIONS = { recruiting: 0.5, short: 0.2 };

const at = (unitsRequired: number, unitsConfirmed: number, belowFloor = false) =>
  pressureFor({ unitsRequired, unitsConfirmed, belowFloor }, FRACTIONS);

describe('pressureFor (§6)', () => {
  it('is covered when nothing is outstanding and the shelf is stocked', () => {
    expect(at(0, 0)).toBe('met');
    expect(at(4, 4)).toBe('met');
    // Over-confirmed is still covered, not something else.
    expect(at(4, 6)).toBe('met');
  });

  it('is never covered while the group is under its floor', () => {
    // A green tile over an empty shelf tells a volunteer the opposite of the
    // truth. Nothing is waiting on it yet, so it is a today job, not a now one.
    expect(at(0, 0, true)).toBe('short');
    expect(at(4, 4, true)).toBe('short');
  });

  it('says nobody yet when nobody has confirmed', () => {
    expect(at(1, 0)).toBe('critical');
    expect(at(20, 0)).toBe('critical');
  });

  it('grades the middle by how much is covered', () => {
    expect(at(10, 5)).toBe('recruiting');
    expect(at(10, 9)).toBe('recruiting');
    expect(at(10, 4)).toBe('short');
    expect(at(10, 2)).toBe('short');
    expect(at(10, 1)).toBe('critical');
  });

  it('reads the boundaries as at-or-above, not above', () => {
    // Half covered is recruiting, and a fifth covered is short. Written down
    // because "0.5 means five of ten" is the kind of thing that drifts.
    expect(at(10, 5)).toBe('recruiting');
    expect(at(10, 4)).toBe('short');
    expect(at(5, 1)).toBe('short');
  });

  it('gives every level a word, because colour is never the only signal', () => {
    for (const level of PRESSURE_LEVELS) {
      expect(PRESSURE_LABELS[level]).toBeTruthy();
    }
  });
});

describe('unitsOutstanding', () => {
  it('never goes negative', () => {
    expect(unitsOutstanding({ unitsRequired: 3, unitsConfirmed: 9, belowFloor: false })).toBe(0);
  });
});

describe('shareMessageFor (§6)', () => {
  const where = { boardUrl: 'https://example.invalid/board' };

  it('names the hospital and the town, and no person', () => {
    const message = shareMessageFor(
      'O-',
      [
        {
          hospitalName: 'Government Medical College',
          town: 'Kozhikode',
          unitsOutstanding: 3,
          neededBy: '12 Sept',
        },
      ],
      where,
    );

    expect(message).toContain('O- blood needed: 3 units');
    expect(message).toContain('Government Medical College, Kozhikode');
    expect(message).toContain('by 12 Sept');
    expect(message).toContain(where.boardUrl);
  });

  it('does not print a town the hospital name already carries', () => {
    const message = shareMessageFor(
      'O-',
      [
        {
          hospitalName: 'Government Medical College Blood Centre, Kozhikode',
          town: 'Kozhikode',
          unitsOutstanding: 2,
          neededBy: '12 Sept',
        },
      ],
      where,
    );

    expect(message).not.toContain('Kozhikode, Kozhikode');
    expect(message).toContain('Government Medical College Blood Centre, Kozhikode: 2 units');
  });

  it('adds up across hospitals', () => {
    const message = shareMessageFor(
      'B+',
      [
        { hospitalName: 'One', town: 'A', unitsOutstanding: 2, neededBy: '12 Sept' },
        { hospitalName: 'Two', town: null, unitsOutstanding: 1, neededBy: '13 Sept' },
      ],
      where,
    );

    expect(message).toContain('3 units');
    // No town, no dangling comma.
    expect(message).toContain('• Two: 1 unit by 13 Sept');
  });

  it('says one unit rather than 1 units', () => {
    const message = shareMessageFor(
      'A+',
      [{ hospitalName: 'One', town: 'A', unitsOutstanding: 1, neededBy: '12 Sept' }],
      where,
    );
    expect(message).toContain('1 unit.');
    expect(message).not.toContain('1 units');
  });

  it('has something to say when nothing is outstanding', () => {
    // A volunteer opening the share sheet on a quiet group gets a thank-you
    // rather than an empty box. §8: every way out is named, including this one.
    const message = shareMessageFor('AB-', [], where);
    expect(message).toContain('nothing outstanding');
    expect(message).toContain(where.boardUrl);
  });
});
