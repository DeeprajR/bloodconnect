/**
 * The return decision rules (§4), pure and dependency-free.
 *
 * Split out of `use-cases/returns.ts` so a client component can import the
 * rule that drives its own form state (`allowedOutcomes`, `defaultOutcome`)
 * without pulling that file's `drizzle-orm` / `@blood-connect/db` /
 * `@blood-connect/platform` imports into the browser bundle. Those packages
 * reach Postgres and native crypto bindings that do not exist in a browser,
 * and a client component that imports anything from a module is forced to
 * evaluate that module's own imports too, tree-shaking notwithstanding.
 */

export type StorageBand = 'under_30m' | '30m_to_limit' | 'over_limit' | 'unknown';
export type ReturnOutcome = 'restock' | 'quarantine' | 'discard';

/**
 * What the centre is *allowed* to do with a returned unit (§4).
 *
 * Pure, so the screen can grey out the impossible choice rather than offering it
 * and refusing afterwards. Restocking is a clinical judgement with a hard time
 * limit in every transfusion SOP. The threshold is configuration, and the
 * conservative reading of "we do not know" is quarantine, never the shelf.
 */
export function allowedOutcomes(band: StorageBand): readonly ReturnOutcome[] {
  return band === 'under_30m'
    ? ['restock', 'quarantine', 'discard']
    : ['quarantine', 'discard'];
}

export const defaultOutcome = (band: StorageBand): ReturnOutcome =>
  band === 'under_30m' ? 'restock' : 'quarantine';
