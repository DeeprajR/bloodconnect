/**
 * Proves the boundary check actually fails on a deep import.
 *
 * The build plan asks for the rule *and* "a CI job that proves it fails on a
 * deep import" — because a misconfigured linter that passes everything looks
 * exactly like a codebase with no violations. This writes a file that breaks the
 * rule, runs the check, and fails if the check was happy.
 *
 * The fixture is removed whether or not the run succeeds.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(repoRoot, 'packages', 'config', 'src', '__boundary_probe__');
const fixture = path.join(fixtureDir, 'deep-import.ts');

/** A deep import into another package's src — exactly what §11.2 forbids. */
const VIOLATION = `// Written by scripts/prove-boundary-check.mjs. Deleted immediately.
import { canDonateRedCellsTo } from '../../../domain/src/blood.js';

export const probe = canDonateRedCellsTo;
`;

/**
 * Runs the cruiser's own entry script under this Node, rather than through a
 * `.bin` shim: the shims are shell scripts on POSIX and `.cmd` files on Windows,
 * and spawning one without a shell fails silently on Windows — which would make
 * this check pass for the wrong reason.
 */
const cruiserEntry = path.join(
  repoRoot,
  'node_modules',
  'dependency-cruiser',
  'bin',
  'dependency-cruise.mjs',
);

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
      'boundary check PASSED on a deliberate deep import — the rule is not working.\n',
    );
    process.stderr.write(output);
    failed = true;
  } else if (!output.includes('no-deep-package-imports')) {
    process.stderr.write(
      'boundary check failed, but not for the deep import — check the rule that fired.\n',
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
