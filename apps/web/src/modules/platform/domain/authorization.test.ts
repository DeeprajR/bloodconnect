import { describe, expect, it } from 'vitest';

import {
  PERMISSIONS,
  ROUTE_RULES,
  accessFor,
  actorHas,
  anonymousActor,
  decideAccess,
  isSameOrigin,
  landingFor,
  permissionsFor,
  roleHas,
  systemActor,
  type Actor,
  type UserRole,
} from './authorization';

const ROLES: readonly UserRole[] = ['doctor', 'admin', 'blood_centre', 'volunteer_admin'];

const as = (role: UserRole): Actor => ({
  kind: 'user',
  userId: '0199f000-0000-7000-8000-000000000001',
  role,
  districtScopeId: null,
});

const deviceActor: Actor = { kind: 'device', deviceId: 'device-1' };

/**
 * §9's role and surface matrix, transcribed.
 *
 * `yes` and `no` are the spec's own words. This table is the assertion; the
 * implementation is what is being checked against it, not the other way round.
 *
 * Columns: anonymous · doctor · admin · blood_centre · volunteer_admin
 */
const MATRIX: readonly {
  surface: string;
  path: string;
  anonymous: boolean;
  doctor: boolean;
  admin: boolean;
  blood_centre: boolean;
  volunteer_admin: boolean;
}[] = [
  {
    surface: 'Landing, sign-in, offline',
    path: '/sign-in',
    anonymous: true,
    doctor: true,
    admin: true,
    blood_centre: true,
    volunteer_admin: true,
  },
  {
    surface: 'Public demand board',
    path: '/board',
    anonymous: true,
    doctor: true,
    admin: true,
    blood_centre: true,
    volunteer_admin: true,
  },
  {
    surface: 'Password reset (OTP)',
    path: '/reset',
    anonymous: true,
    doctor: true,
    admin: true,
    blood_centre: true,
    volunteer_admin: true,
  },
  {
    surface: 'Dashboard, patients, admissions, requests, samples',
    path: '/dashboard',
    anonymous: false,
    doctor: true,
    admin: true,
    blood_centre: false,
    volunteer_admin: false,
  },
  {
    surface: 'Patients',
    path: '/patients',
    anonymous: false,
    doctor: true,
    admin: true,
    blood_centre: false,
    volunteer_admin: false,
  },
  {
    surface: 'Requests',
    path: '/requests',
    anonymous: false,
    doctor: true,
    admin: true,
    blood_centre: false,
    volunteer_admin: false,
  },
  {
    surface: 'Own profile, change password, request update',
    path: '/profile',
    anonymous: false,
    doctor: true,
    admin: true,
    blood_centre: true,
    volunteer_admin: true,
  },
  {
    surface: 'Admin panel, update-request queue',
    path: '/admin',
    anonymous: false,
    doctor: false,
    admin: true,
    blood_centre: false,
    volunteer_admin: false,
  },
  {
    surface: 'Centre inventory / requests / demand / settings',
    path: '/centre',
    anonymous: false,
    doctor: false,
    admin: true,
    blood_centre: true,
    volunteer_admin: false,
  },
  {
    surface: 'Volunteer dashboard',
    path: '/volunteer',
    anonymous: false,
    doctor: false,
    admin: true,
    blood_centre: false,
    volunteer_admin: true,
  },
  {
    surface: 'Camera calibration screen',
    path: '/centre/calibration',
    anonymous: false,
    doctor: false,
    admin: true,
    blood_centre: true,
    volunteer_admin: false,
  },
  {
    surface: 'Camera observation / tag reader endpoint',
    path: '/api/device/observations',
    anonymous: false,
    doctor: false,
    admin: false,
    blood_centre: false,
    volunteer_admin: false,
  },
];

describe('the role and surface matrix (§9)', () => {
  for (const row of MATRIX) {
    describe(`${row.surface} — ${row.path}`, () => {
      it(`anonymous: ${row.anonymous ? 'yes' : 'no'}`, () => {
        expect(decideAccess(row.path, anonymousActor).allowed).toBe(row.anonymous);
      });

      for (const role of ROLES) {
        it(`${role}: ${row[role] ? 'yes' : 'no'}`, () => {
          expect(decideAccess(row.path, as(role)).allowed).toBe(row[role]);
        });
      }
    });
  }

  it('lets no browser session reach a device endpoint, however privileged (§9.2)', () => {
    // The four kinds of caller never share a middleware. An admin cookie is not
    // a device token and must not behave like one.
    for (const role of ROLES) {
      expect(decideAccess('/api/device/observations', as(role))).toEqual({
        allowed: false,
        reason: 'forbidden',
      });
    }
    expect(decideAccess('/api/device/observations', deviceActor).allowed).toBe(true);
  });

  it('lets no device token reach a staff surface', () => {
    for (const path of ['/dashboard', '/centre', '/admin', '/volunteer', '/profile']) {
      expect(decideAccess(path, deviceActor).allowed, path).toBe(false);
    }
  });
});

describe('the refusal distinguishes two cases (§13)', () => {
  it('sends an anonymous visitor to sign in', () => {
    expect(decideAccess('/dashboard', anonymousActor)).toEqual({
      allowed: false,
      reason: 'unauthenticated',
    });
  });

  it('refuses a signed-in user on the wrong surface outright', () => {
    // Not `unauthenticated`: sending them to a sign-in form would suggest a
    // different account might work, which is untrue and an invitation.
    expect(decideAccess('/admin', as('doctor'))).toEqual({
      allowed: false,
      reason: 'forbidden',
    });
  });
});

describe('routes fail closed', () => {
  it('denies a path with no rule', () => {
    // The direction that gets noticed in development rather than in production.
    for (const path of ['/secret', '/api/internal/metrics', '/centre-admin']) {
      expect(accessFor(path)).toEqual({ kind: 'roles', roles: [] });
      expect(decideAccess(path, as('admin')).allowed, path).toBe(false);
    }
  });

  it('matches on path segments, never on a string prefix', () => {
    // `/centres` is not inside `/centre`, and must not inherit its rule.
    expect(decideAccess('/centres', as('blood_centre')).allowed).toBe(false);
    expect(decideAccess('/centre/stock', as('blood_centre')).allowed).toBe(true);
  });

  it('takes the longest matching prefix, not the first written', () => {
    expect(accessFor('/centre/calibration')).toEqual({
      kind: 'roles',
      roles: ['blood_centre', 'admin'],
    });
  });

  it('treats a trailing slash and a query as the same route', () => {
    expect(decideAccess('/admin/', as('doctor')).allowed).toBe(false);
    expect(decideAccess('/admin/?tab=queue', as('admin')).allowed).toBe(true);
  });

  it('does not let the root rule swallow every path', () => {
    expect(accessFor('/')).toEqual({ kind: 'public' });
    expect(accessFor('/dashboard')).not.toEqual({ kind: 'public' });
  });
});

describe('permissions', () => {
  it('never lets the blood centre raise a request', () => {
    // A doctor must not decide on their own request, which is why blood_centre
    // is a separate role rather than a permission on the doctor account (§2.2).
    expect(roleHas('blood_centre', 'requests:manage')).toBe(false);
    expect(roleHas('blood_centre', 'patients:manage')).toBe(false);
  });

  it('never lets a doctor operate the centre', () => {
    expect(roleHas('doctor', 'centre:operate')).toBe(false);
    expect(roleHas('doctor', 'accounts:manage')).toBe(false);
  });

  it('never lets a volunteer admin reach clinical work', () => {
    expect(permissionsFor('volunteer_admin')).toEqual(['profile:manage', 'volunteer:view']);
  });

  it('gives every role its own profile', () => {
    for (const role of ROLES) {
      expect(roleHas(role, 'profile:manage'), role).toBe(true);
    }
  });

  it('grants nothing to an anonymous, system or device actor', () => {
    for (const permission of PERMISSIONS) {
      expect(actorHas(anonymousActor, permission), permission).toBe(false);
      expect(actorHas(systemActor('a job'), permission), permission).toBe(false);
      expect(actorHas(deviceActor, permission), permission).toBe(false);
    }
  });

  it('leaves no permission unreachable by every role', () => {
    // A permission nothing grants is either dead or a role is missing it.
    for (const permission of PERMISSIONS) {
      const holders = ROLES.filter((role) => roleHas(role, permission));
      expect(holders.length, permission).toBeGreaterThan(0);
    }
  });
});

describe('where a role lands after signing in (§3)', () => {
  it('is that role’s own dashboard, never a menu', () => {
    expect(landingFor('doctor')).toBe('/dashboard');
    expect(landingFor('admin')).toBe('/dashboard');
    expect(landingFor('blood_centre')).toBe('/centre');
    expect(landingFor('volunteer_admin')).toBe('/volunteer');
  });

  it('lands every role somewhere that role may actually go', () => {
    for (const role of ROLES) {
      expect(decideAccess(landingFor(role), as(role)).allowed, role).toBe(true);
    }
  });
});

describe('the route table itself', () => {
  it('has no duplicate prefix', () => {
    const prefixes = ROUTE_RULES.map((rule) => rule.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('starts every prefix with a slash', () => {
    for (const rule of ROUTE_RULES) {
      expect(rule.prefix.startsWith('/'), rule.prefix).toBe(true);
    }
  });
});

describe('the same-origin check (§3)', () => {
  it('accepts a request from the same host', () => {
    expect(isSameOrigin('http://localhost:3000', 'localhost:3000')).toBe(true);
    expect(isSameOrigin('https://blood.example.in', 'blood.example.in')).toBe(true);
  });

  it('refuses another origin, including one that merely starts the same', () => {
    expect(isSameOrigin('http://evil.example', 'localhost:3000')).toBe(false);
    // A different port is a different origin.
    expect(isSameOrigin('http://localhost:3001', 'localhost:3000')).toBe(false);
    // And a suffix match is not a match.
    expect(isSameOrigin('https://blood.example.in.evil.test', 'blood.example.in')).toBe(false);
  });

  it('refuses a missing Origin rather than trusting the absence', () => {
    // Every browser that can run this app sends it on a POST. Treating absence
    // as trustworthy is how these checks get quietly bypassed.
    expect(isSameOrigin(null, 'localhost:3000')).toBe(false);
    expect(isSameOrigin(undefined, 'localhost:3000')).toBe(false);
    expect(isSameOrigin('', 'localhost:3000')).toBe(false);
  });

  it('refuses a missing or unparseable value on either side', () => {
    expect(isSameOrigin('http://localhost:3000', null)).toBe(false);
    expect(isSameOrigin('not a url', 'localhost:3000')).toBe(false);
    expect(isSameOrigin('null', 'localhost:3000')).toBe(false);
  });
});
