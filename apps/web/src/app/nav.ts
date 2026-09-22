import type { UserRole } from '@blood-connect/platform';
import type { NavItem } from '@blood-connect/ui';

/**
 * The nav rail's contents, by role.
 *
 * Kept out of the shell component so a lint pass sees exactly one place
 * where the four roles' surfaces are enumerated, and so a route added
 * to `apps/web/src/app` never becomes findable through the sidebar
 * without a matching entry here.
 *
 * The doctor's rail is deliberately thin (ADR 0010): a doctor's app is
 * a request slip, not a workstation, so nothing that isn't the slip and
 * the day's list is on the primary rail.
 */

interface Nav {
  readonly primary: readonly NavItem[];
  readonly secondary: readonly NavItem[];
}

const DOCTOR: Nav = {
  primary: [
    { href: '/dashboard', match: '/dashboard', label: 'Dashboard' },
    { href: '/requests/new', match: '/requests/new', label: 'New request' },
    { href: '/patients/new', match: '/patients/new', label: 'Record patient' },
  ],
  secondary: [{ href: '/profile', match: '/profile', label: 'Profile' }],
};

const BLOOD_CENTRE: Nav = {
  primary: [
    { href: '/centre', match: '/centre', label: 'Centre' },
    { href: '/centre/requests', match: '/centre/requests', label: 'Requests' },
    { href: '/centre/stock', match: '/centre/stock', label: 'Stock' },
    { href: '/centre/donations', match: '/centre/donations', label: 'Donations' },
    { href: '/centre/demands', match: '/centre/demands', label: 'Demands' },
    { href: '/centre/quarantine', match: '/centre/quarantine', label: 'Quarantine' },
    { href: '/centre/tags', match: '/centre/tags', label: 'Tags' },
  ],
  secondary: [
    { href: '/centre/settings', match: '/centre/settings', label: 'Centre settings' },
    { href: '/profile', match: '/profile', label: 'Profile' },
  ],
};

const VOLUNTEER_ADMIN: Nav = {
  primary: [
    { href: '/volunteer', match: '/volunteer', label: 'Board' },
    { href: '/board', match: '/board', label: 'Public board' },
  ],
  secondary: [{ href: '/profile', match: '/profile', label: 'Profile' }],
};

// The administrator role belongs to the admin app on :3001, not this app
// (ADR 0003). Included here defensively so a mis-routed admin session
// still gets a coherent (if empty) shell rather than a crash.
const ADMIN: Nav = {
  primary: [],
  secondary: [{ href: '/profile', match: '/profile', label: 'Profile' }],
};

const BY_ROLE: Readonly<Record<UserRole, Nav>> = {
  doctor: DOCTOR,
  blood_centre: BLOOD_CENTRE,
  volunteer_admin: VOLUNTEER_ADMIN,
  admin: ADMIN,
};

export function navForRole(role: UserRole): Nav {
  return BY_ROLE[role];
}
