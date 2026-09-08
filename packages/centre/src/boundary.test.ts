import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * The module boundary, checked mechanically (§11.2).
 *
 * §11.2 forbids one module reading another's tables. Nothing else in the build
 * can catch that: both modules legitimately import `@blood-connect/db` for
 * their *own* schema, so dependency-cruiser sees one allowed edge and cannot
 * tell `blood_bags` from `blood_requests` inside it.
 *
 * So this reads the source and fails on the table name. It is the same shape as
 * the CI check §5.9 asks for — grep the bot's migrations for `donor_demand` —
 * and it is here for the same reason: a boundary nobody checks is a boundary
 * that has already been crossed somewhere, in a commit that looked reasonable.
 *
 * The centre reaches Module 1 through `@blood-connect/hospital`'s narrow read
 * API, and that is deliberately the only door.
 */

const here = import.meta.dirname;
const packages = path.resolve(here, '..', '..');

/** Module 1's tables. The centre may not name any of them. */
const HOSPITAL_TABLES = [
  'bloodRequests',
  'bloodRequestCounters',
  'admissions',
  'patients',
  'blood_requests',
  'hospital.patients',
] as const;

/** Module 2's tables. Module 1 may not name any of them. */
const CENTRE_TABLES = [
  'bloodBags',
  'rfidTags',
  'tagAssignments',
  'centreDecisions',
  'decisionBags',
  'centreSettings',
  'productShelfLives',
  'donorDemand',
  'blood_bags',
  'centre_decisions',
] as const;

function sourceFiles(root: string): string[] {
  const found: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      // Tests are exempt: a test sets up the other module's rows on purpose,
      // and that is not the coupling this rule is about.
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

describe('module boundaries (§11.2)', () => {
  it('never lets the centre name a Module 1 table', () => {
    const offences: string[] = [];

    for (const file of sourceFiles(path.join(packages, 'centre', 'src'))) {
      const code = codeOf(file);
      for (const table of HOSPITAL_TABLES) {
        if (new RegExp(`\\b${table}\\b`).test(code)) {
          offences.push(`${path.relative(packages, file)} names ${table}`);
        }
      }
    }

    expect(offences).toEqual([]);
  });

  it('never lets Module 1 name a centre table', () => {
    const offences: string[] = [];

    for (const file of sourceFiles(path.join(packages, 'hospital', 'src'))) {
      const code = codeOf(file);
      for (const table of CENTRE_TABLES) {
        if (new RegExp(`\\b${table}\\b`).test(code)) {
          offences.push(`${path.relative(packages, file)} names ${table}`);
        }
      }
    }

    expect(offences).toEqual([]);
  });

  it('keeps the door the centre actually uses', () => {
    // The rule above is only honest if there is a sanctioned way through. If
    // this ever fails, the boundary check has stopped protecting anything and
    // has started blocking the design.
    const entry = readFileSync(path.join(packages, 'hospital', 'src', 'index.ts'), 'utf8');
    expect(entry).toContain('getRequestForDecision');
    expect(entry).toContain('markRequestDecided');
    expect(entry).toContain('listRequestsAwaitingDecision');
  });

  it('proves the check can fail', () => {
    // A green boundary test that cannot go red is worse than none: it reports
    // safety it never established. This asserts the matcher itself works.
    const violating = 'import { bloodRequests } from "@blood-connect/db";';
    const clean = 'import { bloodBags } from "@blood-connect/db";';

    expect(new RegExp('\\bbloodRequests\\b').test(violating)).toBe(true);
    expect(new RegExp('\\bbloodRequests\\b').test(clean)).toBe(false);
  });
});
