import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Module 4 cannot see a person (§6, §11.2).
 *
 * §6 lists what a volunteer must never be shown here: a patient name, a
 * request's clinical detail, a doctor's identity, a donor's name or phone
 * number. Every one of those is a table, and the cheapest way to guarantee the
 * screen cannot show one is to guarantee the module cannot name one.
 *
 * dependency-cruiser stops this package importing `hospital`, `centre` or
 * `bot`, but all four modules legitimately import `@blood-connect/db` for their
 * own schema, so it sees one allowed edge and cannot tell `donor_demand` from
 * `patients` inside it. This reads the source instead.
 *
 * The same shape as the centre's boundary test, for the same reason: a boundary
 * nobody checks has already been crossed somewhere, in a commit that looked
 * reasonable at the time.
 */

const here = import.meta.dirname;
const volunteerSrc = path.join(here);

/** Everything §6 says must not reach this surface. */
const FORBIDDEN_TABLES = [
  // A patient, and the clinical detail attached to one.
  'patients',
  'admissions',
  'bloodRequests',
  'blood_requests',
  'bloodSamples',
  // A doctor's identity.
  'users',
  'userSeals',
  'centreDecisions',
  // The centre's own inventory. Module 4 learns the shelf is low from a
  // `stock_floor` demand on the shared table, not by counting bags (§7).
  'bloodBags',
  'blood_bags',
  'centreSettings',
  // A donor's name or phone number.
  'donors',
  'donorChannels',
  'donorPhones',
  'donorDemandConfirmations',
  'donor_demand_confirmations',
] as const;

/** What it is allowed to read: §7's shared table, and the place hierarchy. */
const PERMITTED_TABLES = ['donorDemand', 'locationNodes'] as const;

const wordMatch = (identifier: string): RegExp =>
  new RegExp(String.raw`\b${identifier.replace(/[.]/g, String.raw`\.`)}\b`);

function sourceFiles(root: string): string[] {
  const found: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (full.endsWith('.ts') && !full.endsWith('.test.ts')) found.push(full);
    }
  };

  walk(root);
  return found;
}

/** Ignores comments, so prose that names a table is not a violation. */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('the volunteer board sees no person (§6)', () => {
  it('names no table holding a patient, a doctor, a donor or a bag', () => {
    const offences: string[] = [];

    for (const file of sourceFiles(volunteerSrc)) {
      const code = codeOf(file);
      for (const table of FORBIDDEN_TABLES) {
        if (wordMatch(table).test(code)) {
          offences.push(`${path.basename(file)} names ${table}`);
        }
      }
    }

    expect(offences).toEqual([]);
  });

  it('still reads the shared demand table, or it is checking nothing', () => {
    // The rule above is only honest if there is something it is allowing
    // through. If this fails, the module has stopped reading anything and the
    // check above has become a test that always passes.
    const code = sourceFiles(volunteerSrc).map(codeOf).join('\n');
    for (const table of PERMITTED_TABLES) {
      expect(wordMatch(table).test(code), table).toBe(true);
    }
  });

  it('proves the check can fail', () => {
    expect(wordMatch('patients').test('import { patients } from "x";')).toBe(true);
    expect(wordMatch('donors').test('import { donorDemand } from "x";')).toBe(false);
    // `donorDemand` must not be mistaken for `donorDemandConfirmations`, which
    // holds a donor id and is on the forbidden list.
    expect(wordMatch('donorDemandConfirmations').test('donorDemand')).toBe(false);
  });
});
