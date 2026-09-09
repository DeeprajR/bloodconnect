import Link from 'next/link';

import type { Actor } from '@blood-connect/platform';

import { AppShell } from './shell';

/**
 * The centre's frame, with its own navigation.
 *
 * Every other surface in this system is one screen deep and needs no menu. The
 * centre is not: a counter moves between the shelf, the donors coming in and
 * the intake form all day, and making each of those a return trip through the
 * overview costs taps somebody makes hundreds of times a shift.
 *
 * The active item is passed in rather than read from the pathname, which keeps
 * these pages server-rendered with no client JavaScript for navigation. A
 * `usePathname` hook here would turn the frame of every centre screen into a
 * client component to render eight links that never change.
 */

export type CentreSection = 'dashboard' | 'donations' | 'register';

const ITEMS: readonly { section: CentreSection; href: string; label: string }[] = [
  { section: 'dashboard', href: '/centre', label: 'Dashboard' },
  { section: 'donations', href: '/centre/donations', label: 'Donation status' },
  { section: 'register', href: '/centre/stock/new', label: 'Register blood bags' },
];

export function CentreShell({
  actor,
  title,
  current,
  children,
  narrow = false,
}: {
  actor: Actor;
  title: string;
  /** Omitted on the screens the menu does not name, which then show none active. */
  current?: CentreSection;
  children: React.ReactNode;
  narrow?: boolean;
}) {
  return (
    <AppShell actor={actor} title={title} narrow={narrow}>
      <div className="app-with-nav">
        <nav className="app-nav" aria-label="Blood centre">
          <ul className="app-nav-list">
            {ITEMS.map((item) => {
              const active = item.section === current;
              return (
                <li key={item.section}>
                  <Link
                    className={`app-nav-link app-target${active ? ' app-nav-link-active' : ''}`}
                    href={item.href}
                    /*
                      The current page, announced rather than only coloured.
                      Without it the active item is a background change and
                      nothing else, which a screen reader cannot convey.
                    */
                    aria-current={active ? 'page' : undefined}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="app-with-nav-body">{children}</div>
      </div>
    </AppShell>
  );
}
