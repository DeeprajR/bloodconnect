/**
 * Proves the boundary check actually fails on a deep import.
 *
 * The build plan asks for the rule *and* "a CI job that proves it fails on a
 * deep import", because a misconfigured linter that passes everything looks
 * exactly like a codebase with no violations. This writes a file that breaks the
 * rule, runs the check, and fails if the check was happy.
 *
 * The fixture is removed whether or not the run succeeds.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(repoRoot, 'packages', 'config', 'src', '__boundary_probe__');
const fixture = path.join(fixtureDir, 'deep-import.ts');

/** A deep import into another package's src. Exactly what §11.2 forbids. */
const VIOLATION = `// Written by scripts/prove-boundary-check.mjs. Deleted immediately.
import { canDonateRedCellsTo } from '../../../domain/src/blood.js';

export const probe = canDonateRedCellsTo;
`;

/**
 * Runs the cruiser's own entry script under this Node, rather than through a
 * `.bin` shim: the shims are shell scripts on POSIX and `.cmd` files on Windows,
 * and spawning one without a shell fails silently on Windows, which would make
 * this check pass for the wrong reason.
 *
 * The binary was renamed in dependency-cruiser 18.3.1 from
 * `dependency-cruise.mjs` to `dependency-cruiser.mjs` (with the trailing `r`).
 * The two candidate paths are tried in order — newer first, so the fresh
 * spelling wins on a fresh install — with the last existing one used.
 * A version bump that renames it again will fail loudly here rather than in
 * the middle of `pnpm verify`, which is what §11.2 asks of every mechanical
 * check.
 */
const cruiserEntryCandidates = [
  path.join(repoRoot, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruiser.mjs'),
  path.join(repoRoot, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruise.mjs'),
];

const cruiserEntry = cruiserEntryCandidates.find((candidate) => existsSync(candidate));

if (cruiserEntry === undefined) {
  process.stderr.write(
    'dependency-cruiser binary not found. Tried:\n' +
      cruiserEntryCandidates.map((candidate) => `  ${candidate}\n`).join('') +
      'Its binary may have been renamed again; update scripts/prove-boundary-check.mjs.\n',
  );
  process.exit(1);
}

function runCruiser() {
  return spawnSync(
    process.execPath,
    [cruiserEntry, 'packages', 'db', '--config', '.dependency-cruiser.cjs'],
    { cwd: repoRoot, encoding: 'utf8', shell: false },
  );
}

let failed = false;
try {
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(fixture, VIOLATION, 'utf8');

  const result = runCruiser();
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

  if (result.status === 0) {
    process.stderr.write(
      'boundary check PASSED on a deliberate deep import, the rule is not working.\n',
    );
    process.stderr.write(output);
    failed = true;
  } else if (!output.includes('no-deep-package-imports')) {
    process.stderr.write(
      'boundary check failed, but not for the deep import, check the rule that fired.\n',
    );
    process.stderr.write(output);
    failed = true;
  } else {
    process.stdout.write(
      'boundary check correctly rejects a deep import into another package.\n',
    );
  }
} finally {
  rmSync(fixtureDir, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
