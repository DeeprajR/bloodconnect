import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * No personal or health data on the panel (§11.9, §12).
 *
 * P10 asks for this to be asserted rather than reviewed, and this module is the
 * one that most needs it. Every other module has a reason to be narrow; the
 * control panel exists to see everything, and it reads across three modules to
 * do it. That is exactly the shape of code that acquires a `donorName` in a
 * select list one afternoon because it made a screen slightly better.
 *
 * The columns below are real columns on tables this module legitimately reads.
 * `donor_demand_confirmations` is the sharp one: the panel reads it for the
 * trace, and the same row carries the donor's name and phone number.
 */

const here = import.meta.dirname;

/** Columns holding a person, on tables this module is otherwise allowed to read. */
const FORBIDDEN_COLUMNS = [
  'donorName',
  'donorPhone',
  'donor_name',
  'donor_phone',
  'patientSnapshot',
  'doctorSnapshot',
  'fullName',
  'toAddress',
  'passwordHash',
  'tokenHash',
] as const;

/** Whole tables that are nothing but people. */
const FORBIDDEN_TABLES = [
  'patients',
  'admissions',
  'users',
  'donors',
  'donorChannels',
  'donorPhones',
  'userSeals',
] as const;

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

/** Ignores comments, so prose naming a column is not a violation. */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('the control panel cannot show a person (§11.9)', () => {
  it('selects no column that holds a name, a number or a secret', () => {
    const offences: string[] = [];

    for (const file of sourceFiles(here)) {
      const code = codeOf(file);
      for (const column of FORBIDDEN_COLUMNS) {
        if (wordMatch(column).test(code)) {
          offences.push(`${path.basename(file)} names ${column}`);
        }
      }
    }

    expect(offences).toEqual([]);
  });

  it('reads no table that is nothing but people', () => {
    const offences: string[] = [];

    for (const file of sourceFiles(here)) {
      const code = codeOf(file);
      for (const table of FORBIDDEN_TABLES) {
        if (wordMatch(table).test(code)) {
          offences.push(`${path.basename(file)} names ${table}`);
        }
      }
    }

    expect(offences).toEqual([]);
  });

  it('still reads the tables the trace is built from', () => {
    // The rules above are only honest if something is being let through. If
    // this fails, the panel has stopped reading anything and the checks have
    // become tests that always pass.
    const code = sourceFiles(here).map(codeOf).join('\n');
    for (const table of ['donorDemand', 'auditLog', 'bloodRequests', 'centreDecisions']) {
      expect(wordMatch(table).test(code), table).toBe(true);
    }
  });

  it('proves the checks can fail', () => {
    expect(wordMatch('donorName').test('select({ donorName: x.donorName })')).toBe(true);
    expect(wordMatch('donorName').test('select({ donorDemand: x })')).toBe(false);
    // `donorDemandConfirmations` is read and must not be mistaken for `donors`.
    expect(wordMatch('donors').test('donorDemandConfirmations')).toBe(false);
  });
});
