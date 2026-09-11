/**
 * Deletes the Next build caches for both applications.
 *
 * Turbopack's development server keeps a per-route manifest under `.next/dev`,
 * and it can be left behind for a route that was added, renamed or compiled
 * while the server was being killed. What that looks like is a page that has
 * always worked failing on navigation with
 *
 *   ENOENT: no such file or directory, open
 *   '.next/dev/server/app/centre/demands/[id]/page/build-manifest.json'
 *
 * The route is fine and the source is fine; the cache is describing a build that
 * no longer exists. There is nothing to fix in the application, so this exists
 * rather than a paragraph in the README telling somebody which directory to
 * delete by hand on Windows.
 *
 * Safe to run at any time: everything removed is a build artefact that the next
 * `pnpm dev` or `pnpm build` regenerates. Stop the development server first, or
 * Windows will refuse to remove files it still has open.
 */

import { rm, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const targets = ['apps/web/.next', 'apps/admin/.next'];

let removed = 0;

for (const target of targets) {
  const full = path.join(root, target);

  try {
    await stat(full);
  } catch {
    process.stdout.write(`${target}: nothing to remove\n`);
    continue;
  }

  try {
    await rm(full, { recursive: true, force: true });
    process.stdout.write(`${target}: removed\n`);
    removed += 1;
  } catch (error) {
    // Almost always a development server still holding the directory open.
    process.stderr.write(
      `${target}: could not remove it. Stop the dev server and run this again.\n` +
        `  ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}

process.stdout.write(
  removed === 0
    ? 'Nothing to clean.\n'
    : 'Done. The next `pnpm dev` rebuilds from source.\n',
);
