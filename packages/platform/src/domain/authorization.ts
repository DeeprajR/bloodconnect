/**
 * Who may do what (§9's role matrix, §13's three layers).
 *
 * Pure data and pure functions, shared by both applications. The three
 * independent layers, route proxy, page guard, use-case check, all read
 * **this** file, so they cannot drift apart; what they do not share is the
 * moment they run, which is the point of having three (§3):
 *
 *   1. The proxy rejects a request before a page renders.
 *   2. The page guard re-reads the session and re-checks.
 *   3. The use case asserts the permission itself, because a job, a script or a
 *      future HTTP caller never passes through either of the first two.
 *
 * **Two applications, one table.** Administration is its own deployment (§1),
 * so a role belongs to exactly one of them: an administrator signs in to the
 * admin app and nowhere else, and no other role signs in there. Sessions carry
 * the audience that issued them, so a cookie from one is inert in the other
 * even where they share a hostname.
 */

import type { UserRole } from '@blood-connect/db';

export type { UserRole };

/** Which application a principal belongs to. */
export type Audience = 'staff' | 'admin';

/**
 * The role split. Administration has no clinical function, and the clinical
 * roles have no administrative one, so an account compromised on either side
 * reaches only that side.
 */
export const ROLES_BY_AUDIENCE: Readonly<Record<Audience, readonly UserRole[]>> = {
  staff: ['doctor', 'blood_centre', 'volunteer_admin'],
  admin: ['admin'],
};

export const audienceFor = (role: UserRole): Audience =>
  ROLES_BY_AUDIENCE.admin.includes(role) ? 'admin' : 'staff';

/**
 * The actor every use case takes in its context. A use case never reads a
 * cookie, and never accepts a doctor id from the client (§2.5). Identity is
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
  'doctors:manage',
  'patients:read_all',
  'centre:operate',
  'centre:configure',
  'volunteer:view',
  'config:write',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly Permission[]>> = {
  doctor: ['requests:manage', 'patients:manage', 'profile:manage'],

  /**
   * Administration is account management, and nothing clinical.
   *
   * It deliberately holds neither `requests:manage` nor `centre:operate`: an
   * administrator cannot raise a blood request or issue a unit, which keeps the
   * separation §2.2 draws between raising and deciding intact no matter how
   * many roles one person is given.
   *
   * `patients:read_all` is the exception and the one to watch. It lets a
   * non-clinical account read patient records in order to see a doctor's
   * workload. Every read under it is audited, and its lawful basis is an open
   * question for counsel (§12.2).
   */
  admin: ['doctors:manage', 'patients:read_all', 'profile:manage', 'config:write'],

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
  /** Signed in, any role the application admits. */
  | { readonly kind: 'authenticated' }
  | { readonly kind: 'roles'; readonly roles: readonly UserRole[] }
  /** A device token, never a session, no browser reaches these (§9.2). */
  | { readonly kind: 'device' };

export type RouteRule = { readonly prefix: string; readonly access: RouteAccess };

/**
 * Longest prefix wins, so `/centre/calibration` can differ from `/centre`
 * without depending on the order this array happens to be written in.
 *
 * Anything not matched is **denied**. A new route added without a rule is
 * inaccessible rather than open, the failure direction that gets noticed in
 * development instead of in production.
 */
export const STAFF_ROUTE_RULES: readonly RouteRule[] = [
  { prefix: '/', access: { kind: 'public' } },
  { prefix: '/sign-in', access: { kind: 'public' } },
  { prefix: '/sign-out', access: { kind: 'authenticated' } },
  { prefix: '/offline', access: { kind: 'public' } },
  { prefix: '/manifest.webmanifest', access: { kind: 'public' } },
  { prefix: '/sw.js', access: { kind: 'public' } },
  { prefix: '/board', access: { kind: 'public' } },
  { prefix: '/reset', access: { kind: 'public' } },
  // The invite link and the address-change confirmation both arrive by email
  // and are opened by someone who is not signed in, that is the whole point.
  { prefix: '/invite', access: { kind: 'public' } },
  { prefix: '/confirm-email', access: { kind: 'public' } },

  { prefix: '/dashboard', access: { kind: 'roles', roles: ['doctor'] } },
  { prefix: '/patients', access: { kind: 'roles', roles: ['doctor'] } },
  { prefix: '/admissions', access: { kind: 'roles', roles: ['doctor'] } },
  { prefix: '/requests', access: { kind: 'roles', roles: ['doctor'] } },
  { prefix: '/samples', access: { kind: 'roles', roles: ['doctor'] } },

  { prefix: '/profile', access: { kind: 'authenticated' } },

  { prefix: '/centre', access: { kind: 'roles', roles: ['blood_centre'] } },
  { prefix: '/volunteer', access: { kind: 'roles', roles: ['volunteer_admin'] } },

  { prefix: '/api/device', access: { kind: 'device' } },
  { prefix: '/api/public', access: { kind: 'public' } },
  /*
   * The load balancer's probe (§11.9). Public because a health check behind a
   * session is a health check the load balancer cannot make, and shallow enough
   * that being public costs nothing: one word and a status code, never a list
   * of dependencies.
   */
  { prefix: '/api/health', access: { kind: 'public' } },
];

/**
 * The admin application. Every surface is administrator-only; there is no
 * public page beyond signing in, and no other role can hold a session here at
 * all.
 */
export const ADMIN_ROUTE_RULES: readonly RouteRule[] = [
  { prefix: '/', access: { kind: 'roles', roles: ['admin'] } },
  { prefix: '/sign-in', access: { kind: 'public' } },
  { prefix: '/sign-out', access: { kind: 'authenticated' } },
  { prefix: '/reset', access: { kind: 'public' } },
  { prefix: '/invite', access: { kind: 'public' } },
  { prefix: '/confirm-email', access: { kind: 'public' } },
  { prefix: '/offline', access: { kind: 'public' } },
  { prefix: '/manifest.webmanifest', access: { kind: 'public' } },
  { prefix: '/sw.js', access: { kind: 'public' } },
  { prefix: '/api/health', access: { kind: 'public' } },

  { prefix: '/doctors', access: { kind: 'roles', roles: ['admin'] } },
  { prefix: '/updates', access: { kind: 'roles', roles: ['admin'] } },
  // The control panel (§11.9). Administrator-only, and holding no clinical
  // function: it can read that a demand is stuck, not answer a request.
  { prefix: '/panel', access: { kind: 'roles', roles: ['admin'] } },
  { prefix: '/profile', access: { kind: 'roles', roles: ['admin'] } },
  { prefix: '/api/seal', access: { kind: 'roles', roles: ['admin'] } },
];

const RULES_BY_AUDIENCE: Readonly<Record<Audience, readonly RouteRule[]>> = {
  staff: STAFF_ROUTE_RULES,
  admin: ADMIN_ROUTE_RULES,
};

/** Denied. A route with no rule is not a route anyone can reach. */
export const defaultAccess: RouteAccess = { kind: 'roles', roles: [] };

export function accessFor(pathname: string, audience: Audience = 'staff'): RouteAccess {
  const path = normalisePath(pathname);
  let best: RouteRule | undefined;

  for (const rule of RULES_BY_AUDIENCE[audience]) {
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
export function decideAccess(
  pathname: string,
  actor: Actor,
  audience: Audience = 'staff',
): AccessDecision {
  const access = accessFor(pathname, audience);

  // A role belongs to exactly one application (§1). Checked before the route
  // rules so that a doctor presented at the admin app is refused outright
  // rather than falling through to whatever that path happens to allow.
  if (
    actor.kind === 'user' &&
    !ROLES_BY_AUDIENCE[audience].includes(actor.role) &&
    access.kind !== 'public'
  ) {
    return forbidden;
  }

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

/* -------------------------------------------------------------------------- */
/* CSRF                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The same-origin comparison behind every mutating request (§3).
 *
 * Pure, and here rather than in the adapter, so it can be tested without a
 * request. `sameSite=lax` already blocks the cross-site POST that carries the
 * cookie; this is the second of two independent controls.
 *
 * A missing `Origin` is **not** same-origin. Every browser that can run this
 * app sends it on a POST, and treating absence as trustworthy is how these
 * checks get quietly bypassed.
 */
export function isSameOrigin(
  origin: string | null | undefined,
  host: string | null | undefined,
): boolean {
  if (!origin || !host) return false;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    // An unparseable Origin is not a matching one.
    return false;
  }

  return originHost === host;
}

/**
 * Where a role lands after signing in. Never a generic page: the invite flow
 * ends "signed in on the dashboard for their role", not on a menu (§3).
 */
const LANDING: Readonly<Record<UserRole, string>> = {
  doctor: '/dashboard',
  blood_centre: '/centre',
  volunteer_admin: '/volunteer',
  // In the admin application, which has no other landing place.
  admin: '/doctors',
};

export const landingFor = (role: UserRole): string => LANDING[role];
