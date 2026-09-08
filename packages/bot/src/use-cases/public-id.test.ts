import { describe, expect, it } from 'vitest';

import { newId } from '@blood-connect/ids';

import { makePublicId } from './import-demand.js';

/**
 * The deep-link id (§5.7).
 *
 * This is the only identifier of a request that leaves the system: it goes in a
 * URL, into a message, and sometimes out of somebody's mouth. Two requests
 * sharing one would send donors to the wrong demand.
 *
 * The first version derived it from the **start** of a UUIDv7, which is a
 * millisecond timestamp — so ids minted in the same second produced the same
 * public id. It passed every unit test that generated one id at a time, and
 * failed the second import of a real run. This test is written the way that
 * failure would have been caught.
 */
describe('the deep-link id', () => {
  it('does not collide across ids minted in the same instant', () => {
    // The exact failure: a thousand identifiers created as fast as possible,
    // which is what a batch import does.
    const ids = Array.from({ length: 1000 }, () => makePublicId(newId()));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is stable for the same identifier', () => {
    const id = newId();
    expect(makePublicId(id)).toBe(makePublicId(id));
  });

  it('excludes the characters people confuse when reading one aloud', () => {
    for (let i = 0; i < 200; i += 1) {
      const body = makePublicId(newId()).slice(3);
      // No O/0 and no I/1: somebody will transcribe one of these by hand.
      expect(body).not.toMatch(/[O0I1]/);
      expect(body).toHaveLength(6);
    }
  });

  it('is prefixed so it is recognisable out of context', () => {
    expect(makePublicId(newId()).startsWith('BC-')).toBe(true);
  });

  it('tolerates an identifier with the hyphens already stripped', () => {
    const id = newId();
    expect(makePublicId(id)).toBe(makePublicId(id.replace(/-/g, '')));
  });
});
