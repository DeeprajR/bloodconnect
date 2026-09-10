/**
 * Which district a caller sees (§6).
 *
 * A volunteer admin may be scoped to one district, matching the scoping on
 * their chat whitelist; `district_scope_id` null means the whole state.
 *
 * Derived from the actor rather than taken from the request, so a scoped
 * volunteer cannot widen their own view by editing a query string. That is the
 * only authorization decision this module makes, and it is here rather than in
 * a page so that every surface makes it the same way.
 */

import type { Actor } from '@blood-connect/platform';

import { UNSCOPED, type Scope } from './read.js';

export function scopeFor(actor: Actor): Scope {
  if (actor.kind !== 'user') return UNSCOPED;
  return actor.districtScopeId === null ? UNSCOPED : { districtId: actor.districtScopeId };
}
