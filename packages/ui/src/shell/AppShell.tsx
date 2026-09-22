'use client';

/**
 * Application shell — a fixed sidebar on desktop, a slide-out drawer
 * on mobile, and a sticky header naming the current section.
 *
 * Presentation only. Session gating is the caller's job: a page a
 * signed-out user must not see is protected by a server-side check in
 * the app (Bloodconnect: `currentActor()` + `redirect('/sign-in')`),
 * not by this shell. The shell renders whatever it is given.
 */

import { useState } from 'react';
import {
  SidebarContent,
  type NavItem,
  type SidebarProps,
} from './Sidebar.js';
import { type ReactNode } from 'react';

export interface AppShellProps
  extends Omit<SidebarProps, 'onNavigate'> {
  /** Displayed in the sticky header. Usually the current nav item's
   * label; the app resolves it once and passes it in. */
  currentTitle: string;
  /** Optional slot for a small pill or banner in the header top-right
   * (e.g. an "Offline" indicator). */
  headerSlot?: ReactNode;
  children: ReactNode;
}

export { type NavItem };

export function AppShell({
  brand,
  user,
  primaryNav,
  secondaryNav,
  currentPath,
  currentTitle,
  signOutSlot,
  headerSlot,
  children,
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-surface lg:block">
        <div className="sticky top-0 h-dvh">
          <SidebarContent
            brand={brand}
            user={user}
            primaryNav={primaryNav}
            secondaryNav={secondaryNav}
            currentPath={currentPath}
            signOutSlot={signOutSlot}
          />
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-ink/40 lg:hidden"
          onClick={() => { setMobileOpen(false); }}
        >
          <div
            className="h-full w-72 max-w-[80%] bg-surface shadow-overlay"
            onClick={(e) => { e.stopPropagation(); }}
          >
            <SidebarContent
              brand={brand}
              user={user}
              primaryNav={primaryNav}
              secondaryNav={secondaryNav}
              currentPath={currentPath}
              signOutSlot={signOutSlot}
              onNavigate={() => { setMobileOpen(false); }}
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface px-4">
          <button
            type="button"
            onClick={() => { setMobileOpen(true); }}
            aria-label="Open navigation"
            className="rounded-control border border-border-strong p-1.5 text-ink-muted hover:bg-surface-muted lg:hidden"
          >
            ☰
          </button>
          <span className="text-sm font-semibold text-ink">{currentTitle}</span>
          {headerSlot && <div className="ml-auto">{headerSlot}</div>}
        </header>
        <main
          id="main"
          className="mx-auto w-full max-w-6xl flex-1 space-y-6 p-4 sm:p-6"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
