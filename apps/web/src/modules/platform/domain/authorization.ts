/**
 * Who may do what (§9's role matrix, §13's three layers).
 *
 * Pure data and pure functions. The three independent layers — route
 * middleware, page guard, use-case check — all read **this** file, so they
 * cannot drift apart; what they do not share is the moment they run, which is
 * the whole point of having three (§3):
 *
 *   1. Middleware rejects a request before a page renders.
 *   2. The page guard re-reads the session and re-checks, because middleware
 *      can be misconfigured and a route can be added without a matcher.
 *   3. The use case asserts the permission itself, because a job, a script or a
 *      future HTTP caller never passes through either of the first two.
 *
 * No single mistake grants access.
 */

import type { UserRole } from '@blood-connect/db';

export type { UserRole };

/**
 * The actor every use case takes in its context. A use case never reads a
 * cookie, and never accepts a doctor id from the client (§2.5) — identity is
 * resolved once at the edge and passed down.
 */
export type Actor =
  | {
      readonly kind: 'user';
      readonly userId: string;
      readonly role: UserRole;
      /** A volunteer admin may be scoped to one district; null means all (§6). */
      readonly districtScopeId: string | null;
    }
  | { readonly kind: 'system'; readonly reason: string }
  | { readonly kind: 'device'; readonly deviceId: string }
  | { readonly kind: 'anonymous' };

export const systemActor = (reason: string): Actor => ({ kind: 'system', reason });
export const anonymousActor: Actor = { kind: 'anonymous' };

/* -------------------------------------------------------------------------- */
/* Permissions                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Named for what someone is doing, not for the screen they are on. A screen can
 * be renamed or split; "decide a blood request" cannot.
 */
export const PERMISSIONS = [
  'requests:manage',
  'patients:manage',
  'profile:manage',
  'accounts:manage',
  'centre:operate',
  'centre:configure',
  'volunteer:view',
  'config:write',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * §9's matrix, transposed. `admin` appears in almost every row because the
 * matrix says so — an admin can reach the centre and volunteer surfaces — but
 * note the row it is *absent* from below.
 */
const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly Permission[]>> = {
  doctor: ['requests:manage', 'patients:manage', 'profile:manage'],

  admin: [
    'requests:manage',
    'patients:manage',
    'profile:manage',
    'accounts:manage',
    'centre:operate',
    'centre:configure',
    'volunteer:view',
    'config:write',
  ],

  // The centre answers requests; it does not raise them. A doctor must not be
  // able to decide on their own request, which is why `blood_centre` is a
  // separate role rather than a permission on the doctor account (§2.2).
  blood_centre: ['profile:manage', 'centre:operate', 'centre:configure'],

  volunteer_admin: ['profile:manage', 'volunteer:view'],
};

export const permissionsFor = (role: UserRole): readonly Permission[] =>
  ROLE_PERMISSIONS[role];

export const roleHas = (role: UserRole, permission: Permission): boolean =>
  ROLE_PERMISSIONS[role].includes(permission);

/**
 * The check a use case makes. Only an active signed-in user holds a permission:
 * a device token authenticates a machine endpoint and grants nothing here, and
 * `system` is used by jobs, which assert their own narrower conditions.
 */
export function actorHas(actor: Actor, permission: Permission): boolean {
  return actor.kind === 'user' && roleHas(actor.role, permission);
}

/* -------------------------------------------------------------------------- */
/* Routes                                                                      */
/* -------------------------------------------------------------------------- */

export type RouteAccess =
  | { readonly kind: 'public' }
  /** Signed in, any role — the profile surfaces of §9. */
  | { readonly kind: 'authenticated' }
  | { readonly kind: 'roles'; readonly roles: readonly UserRole[] }
  /** A device token, never a session — no browser reaches these (§9.2). */
  | { readonly kind: 'device' };

export type RouteRule = { readonly prefix: string; readonly access: RouteAccess };

/**
 * Longest prefix wins, so `/centre/calibration` can differ from `/centre`
 * without depending on the order this array happens to be written in.
 *
 * Anything not matched here is **denied** (`defaultAccess` below). A new route
 * added without a rule is inaccessible rather than open — the failure direction
 * that gets noticed in development instead of in production.
 */
export const ROUTE_RULES: readonly RouteRule[] = [
  { prefix: '/', access: { kind: 'public' } },
  { prefix: '/sign-in', access: { kind: 'public' } },
  { prefix: '/sign-out', access: { kind: 'authenticated' } },
  { prefix: '/offline', access: { kind: 'public' } },
  { prefix: '/board', access: { kind: 'public' } },
  { prefix: '/reset', access: { kind: 'public' } },
  { prefix: '/invite', access: { kind: 'public' } },

  { prefix: '/dashboard', access: { kind: 'roles', roles: ['doctor', 'admin'] } },
  { prefix: '/patients', access: { kind: 'roles', roles: ['doctor', 'admin'] } },
  { prefix: '/admissions', access: { kind: 'roles', roles: ['doctor', 'admin'] } },
  { prefix: '/requests', access: { kind: 'roles', roles: ['doctor', 'admin'] } },
  { prefix: '/samples', access: { kind: 'roles', roles: ['doctor', 'admin'] } },

  { prefix: '/profile', access: { kind: 'authenticated' } },

  { prefix: '/admin', access: { kind: 'roles', roles: ['admin'] } },
  { prefix: '/centre', access: { kind: 'roles', roles: ['blood_centre', 'admin'] } },
  { prefix: '/volunteer', access: { kind: 'roles', roles: ['volunteer_admin', 'admin'] } },

  { prefix: '/api/device', access: { kind: 'device' } },
  { prefix: '/api/public', access: { kind: 'public' } },
];

/** Denied. A route with no rule is not a route anyone can reach. */
export const defaultAccess: RouteAccess = { kind: 'roles', roles: [] };

export function accessFor(pathname: string): RouteAccess {
  const path = normalisePath(pathname);
  let best: RouteRule | undefined;

  for (const rule of ROUTE_RULES) {
    if (!matches(path, rule.prefix)) continue;
    if (best === undefined || rule.prefix.length > best.prefix.length) best = rule;
  }

  return best?.access ?? defaultAccess;
}

const normalisePath = (pathname: string): string => {
  const withoutQuery = pathname.split('?')[0] ?? '/';
  const trimmed = withoutQuery.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
};

/** `/centre` matches `/centre` and `/centre/stock`, but never `/centres`. */
const matches = (path: string, prefix: string): boolean =>
  prefix === '/' ? path === '/' : path === prefix || path.startsWith(`${prefix}/`);

export type AccessDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: 'unauthenticated' | 'forbidden' };

const allow: AccessDecision = { allowed: true };
const unauthenticated: AccessDecision = { allowed: false, reason: 'unauthenticated' };
const forbidden: AccessDecision = { allowed: false, reason: 'forbidden' };

/**
 * The single decision function all three layers call.
 *
 * The distinction between the two refusals matters: an anonymous visitor is
 * sent to sign in, and a signed-in user on the wrong surface is refused
 * outright. Sending the second one to a sign-in form would suggest a different
 * account might work, which is both untrue and an invitation.
 */
export function decideAccess(pathname: string, actor: Actor): AccessDecision {
  const access = accessFor(pathname);

  switch (access.kind) {
    case 'public':
      return allow;

    case 'authenticated':
      return actor.kind === 'user' ? allow : unauthenticated;

    case 'roles':
      if (actor.kind !== 'user') return unauthenticated;
      return access.roles.includes(actor.role) ? allow : forbidden;

    case 'device':
      // A browser session must never satisfy a device route, however
      // privileged: §9 gives machine callers their own authentication and says
      // the four kinds never share a middleware.
      return actor.kind === 'device' ? allow : forbidden;
  }
}

/**
 * Where a role lands after signing in. Never a generic page: the invite flow
 * ends "signed in on the dashboard for their role", not on a menu (§3).
 */
const LANDING: Readonly<Record<UserRole, string>> = {
  doctor: '/dashboard',
  admin: '/dashboard',
  blood_centre: '/centre',
  volunteer_admin: '/volunteer',
};

export const landingFor = (role: UserRole): string => LANDING[role];
