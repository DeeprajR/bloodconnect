import 'server-only';

import type { ReactNode } from 'react';
import { AppShell as KitAppShell } from '@blood-connect/ui';

import { PRIMARY_NAV, SECONDARY_NAV } from './nav';
import { SignOutButton } from './sign-out-button';

/**
 * The administration frame, on the kit (ADR 0015).
 *
 * Visibly a different application from the staff one: a slate-blue accent
 * (`accent-admin.css`) rather than medical red, a different brand mark, and
 * its own sign-out/session cookie. Somebody who has both accounts should
 * never be in doubt about which system they are typing into.
 *
 * Mirrors apps/web's `kit-shell.tsx`. Server component so the nav is
 * resolved on the server; the kit's `AppShell` is a `"use client"`
 * boundary that runs from there.
 */
export function KitShell({
  currentPath,
  currentTitle,
  children,
}: {
  /** The page's own path, e.g. `/doctors`. Read as-is by the sidebar to
   * mark the active nav item. */
  currentPath: string;
  /** Shown in the sticky header. Usually the same phrase as the H1 the
   * page renders under `PageHeader`. */
  currentTitle: string;
  children: ReactNode;
}) {
  return (
    <KitAppShell
      brand={{ title: 'Blood Connect', subtitle: 'Administration', letter: 'B' }}
      user={{ name: 'Administrator' }}
      primaryNav={PRIMARY_NAV}
      secondaryNav={SECONDARY_NAV}
      currentPath={currentPath}
      currentTitle={currentTitle}
      signOutSlot={<SignOutButton />}
    >
      {children}
      <footer className="mt-8 border-t border-border pt-4 text-xs text-ink-subtle">
        Administration only. This application holds no clinical function
        and cannot raise or decide a blood request. Running on synthetic
        data.
      </footer>
    </KitAppShell>
  );
}
