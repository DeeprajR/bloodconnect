import 'server-only';

import type { ReactNode } from 'react';
import type { UserRole } from '@blood-connect/platform';
import { AppShell as KitAppShell } from '@blood-connect/ui';

import { navForRole } from './nav';
import { SignOutButton } from './sign-out-button';

const ROLE_LABELS: Readonly<Record<UserRole, string>> = {
  doctor: 'Doctor',
  admin: 'Administrator',
  blood_centre: 'Blood centre',
  volunteer_admin: 'Volunteer admin',
};

/**
 * The kit-styled application shell (ADR 0015).
 *
 * Wraps the `@blood-connect/ui` `AppShell` with Bloodconnect's per-role
 * nav config, sign-out server-action form, and the medical disclaimer
 * §12.6 requires on every clinical surface. Server component so the
 * role + nav are resolved on the server; the kit's `AppShell` is a
 * `"use client"` boundary that runs from there.
 *
 * Coexists with `./shell.tsx` (UX4G-based) while the screens are
 * ported one at a time. A page reached from either shell is otherwise
 * identical: the shell decides its own chrome, the page decides its
 * own contents.
 */
export function KitShell({
  role,
  currentPath,
  currentTitle,
  children,
}: {
  role: UserRole;
  /** The page's own path, e.g. `/dashboard`. Read as-is by the sidebar
   * to mark the active nav item. */
  currentPath: string;
  /** Shown in the sticky header. Usually the same phrase as the H1 the
   * page renders under `PageHeader`. */
  currentTitle: string;
  children: ReactNode;
}) {
  const { primary, secondary } = navForRole(role);

  return (
    <KitAppShell
      brand={{ title: 'Blood Connect', subtitle: ROLE_LABELS[role], letter: 'B' }}
      user={{ name: ROLE_LABELS[role] }}
      primaryNav={primary}
      secondaryNav={secondary}
      currentPath={currentPath}
      currentTitle={currentTitle}
      signOutSlot={<SignOutButton />}
      headerSlot={
        <span className="rounded-full border border-border bg-surface-muted px-2 py-0.5 text-xs font-medium text-ink-muted">
          {ROLE_LABELS[role]}
        </span>
      }
    >
      {children}
      <footer className="mt-8 border-t border-border pt-4 text-xs text-ink-subtle">
        Not a medical device. This system does not make clinical
        decisions; the pre-donation assessment and the pre-transfusion
        compatibility test always happen on site. Running on synthetic
        data, no real patient or donor record.
      </footer>
    </KitAppShell>
  );
}
