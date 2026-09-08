import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Locate a file or directory by walking up from a starting point.
 *
 * Everything in this package runs compiled (`dist/src/...`) but is written and
 * read as source (`src/...`), and the two sit at different depths. Walking up
 * means a path is correct in both, rather than correct in whichever one was
 * tried first.
 */
export function findUp(relative: string, from: string): string {
  let directory = from;
  for (;;) {
    const candidate = path.join(directory, relative);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error(`could not find ${relative} above ${from}`);
    }
    directory = parent;
  }
}

/** The same walk, but absence is an answer rather than an error. */
export function tryFindUp(relative: string, from: string): string | undefined {
  try {
    return findUp(relative, from);
  } catch {
    return undefined;
  }
}
