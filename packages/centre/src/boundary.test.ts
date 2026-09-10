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
 * the CI check §5.9 asks for, grep the bot's migrations for `donor_demand`,
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

/** Module 3's tables. Nothing in the web release may name one. */
const BOT_TABLES = [
  'donorChannels',
  'donorPhones',
  'botRequests',
  'donorRequests',
  'conversationState',
  'messageOutbox',
  'bot.donors',
] as const;

/**
 * One matcher, built once, so every check here is escaped the same way.
 *
 * `String.raw` because `\b` inside an ordinary template literal is a backspace
 * character, not a word boundary, which is how the bot check below was first
 * written. It passed against every file, and would have passed against a
 * violation too.
 */
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
        if (wordMatch(table).test(code)) {
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
        if (wordMatch(table).test(code)) {
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

  it('never lets the web release name a bot table', () => {
    // §1: the bot is a separate deployable on a different database role, and
    // `app_web` holds no grant on the `bot` schema at all. A name appearing
    // here would be code that cannot run, and the reason it cannot is the
    // privacy boundary of §5.1, so it is worth failing the build over.
    const offences: string[] = [];

    for (const module of ['centre', 'hospital', 'platform']) {
      const root = path.join(packages, module, 'src');
      for (const file of sourceFiles(root)) {
        const code = codeOf(file);
        for (const table of BOT_TABLES) {
          if (wordMatch(table).test(code)) {
            offences.push(`${path.relative(packages, file)} names ${table}`);
          }
        }
      }
    }

    expect(offences).toEqual([]);
  });

  it('proves the checks can fail', () => {
    // A green boundary test that cannot go red is worse than none: it reports
    // safety it never established. This asserts the matcher itself works, on
    // the exact strings the checks above are looking for.
    expect(wordMatch('bloodRequests').test('import { bloodRequests } from "x";')).toBe(true);
    expect(wordMatch('bloodRequests').test('import { bloodBags } from "x";')).toBe(false);
    expect(wordMatch('botRequests').test('import { botRequests } from "x/bot";')).toBe(true);

    // And not a partial match: `donorDemand` is the centre's table, not a
    // donor table, and confusing the two would fail every file in the repo.
    expect(wordMatch('donorRequests').test('import { donorDemand } from "x";')).toBe(false);
  });
});
