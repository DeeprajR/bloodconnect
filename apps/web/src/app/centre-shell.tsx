import 'server-only';

import type { Actor } from '@blood-connect/platform';

import { KitShell } from './kit-shell';

/**
 * The centre's frame (§4).
 *
 * PR-08 of the UX4G-replacement track (ADR 0015) rewrites this from a
 * bespoke UX4G shell with its own horizontal sub-nav into a thin
 * passthrough over `KitShell`. The kit's sidebar already carries every
 * centre link the horizontal nav had, so keeping two rails would ask a
 * counter to read the same names twice.
 *
 * This one change ports the *chrome* of every centre page at once. Their
 * *content* is still UX4G until each is restyled in its own PR; a
 * mismatched card inside the kit sidebar is the same accepted
 * intermediate state we accepted for the doctor's sign-out button in
 * PR-03 (§9's "one-screen-at-a-time" rollout).
 */

export type CentreSection = 'dashboard' | 'requests' | 'donations' | 'register';

const PATH_BY_SECTION: Readonly<Record<CentreSection, string>> = {
  dashboard: '/centre',
  requests: '/centre/requests',
  donations: '/centre/donations',
  register: '/centre/stock/new',
};

export function CentreShell({
  actor,
  title,
  current,
  currentPath,
  children,
}: {
  actor: Actor;
  title: string;
  /** Legacy: the horizontal nav section that used to be shown here.
   * Kept so the seven centre pages that still call CentreShell with
   * `current="…"` compile unchanged until each is ported. */
  current?: CentreSection;
  /** New: the actual URL path, used by the kit sidebar to highlight
   * the right item. Restyled pages pass this explicitly. */
  currentPath?: string;
  children: React.ReactNode;
  /** Legacy prop from the old shell. The kit's own layout is already
   * capped to a readable width; nothing extra to do. */
  narrow?: boolean;
}) {
  if (actor.kind !== 'user') return null;

  const path =
    currentPath ?? (current !== undefined ? PATH_BY_SECTION[current] : '/centre');

  return (
    <KitShell role={actor.role} currentPath={path} currentTitle={title}>
      {children}
    </KitShell>
  );
}
