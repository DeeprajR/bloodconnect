'use client';

/**
 * The application sidebar — a nav rail with a brand mark, a primary
 * link list, a secondary link list under a heading, and a user card
 * with a sign-out slot at the bottom.
 *
 * Presentation only. This component knows nothing about routing,
 * sessions, or roles: the consumer resolves the current path (usually
 * via `usePathname()` in the AppShell) and passes it in as
 * `currentPath`, resolves the signed-in account and passes it in as
 * `user`, and renders whatever sign-out control fits the app —
 * typically a `<form action={signOutAction}>` on Bloodconnect —
 * through the `signOutSlot` prop.
 */

import Link from 'next/link';
import { type ReactNode } from 'react';
import { cn } from '../primitives/cn.js';

export interface NavItem {
  /** URL to link to. */
  href: string;
  /**
   * The path prefix that marks this item as active. `currentPath ===
   * match` or `currentPath.startsWith(match + "/")` counts as active.
   */
  match: string;
  label: string;
}

export interface SidebarProps {
  brand: { title: string; subtitle: string; letter: string };
  user: { name: string; email: string } | null;
  primaryNav: readonly NavItem[];
  secondaryNav: readonly NavItem[];
  currentPath: string;
  /** Rendered inside the user card, below the email. Usually a small
   * sign-out form or link. Optional; omit for a shell with no
   * sign-out (e.g. a public board). */
  signOutSlot?: ReactNode;
  /** Called after any nav link click. Used by the mobile drawer to
   * close itself. */
  onNavigate?: () => void;
}

export function SidebarContent({
  brand,
  user,
  primaryNav,
  secondaryNav,
  currentPath,
  signOutSlot,
  onNavigate,
}: SidebarProps) {
  const isActive = (match: string) =>
    currentPath === match || currentPath.startsWith(`${match}/`);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 py-4">
        <span
          aria-hidden
          className="flex size-8 items-center justify-center rounded-control bg-primary text-sm font-bold text-white"
        >
          {brand.letter}
        </span>
        <div>
          <p className="text-sm font-semibold text-ink">{brand.title}</p>
          <p className="text-xs text-ink-subtle">{brand.subtitle}</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-2" aria-label="Primary">
        {primaryNav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={isActive(item.match) ? 'page' : undefined}
            className={cn(
              'block rounded-control px-3 py-2 text-sm font-medium transition-colors',
              isActive(item.match)
                ? 'bg-primary-soft text-primary'
                : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {secondaryNav.length > 0 && (
        <div className="border-t border-border px-3 py-3">
          <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">
            Settings
          </p>
          {secondaryNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={isActive(item.match) ? 'page' : undefined}
              className={cn(
                'block rounded-control px-3 py-2 text-sm font-medium transition-colors',
                isActive(item.match)
                  ? 'bg-primary-soft text-primary'
                  : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
              )}
            >
              {item.label}
            </Link>
          ))}
          {user && (
            <div className="mt-2 rounded-control bg-surface-muted px-3 py-2">
              <p className="truncate text-sm font-medium text-ink">
                {user.name}
              </p>
              <p className="truncate text-xs text-ink-subtle">{user.email}</p>
              {signOutSlot && <div className="mt-1.5">{signOutSlot}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
