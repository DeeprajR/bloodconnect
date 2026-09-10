/**
 * Signs in against a running server, exactly as a browser with JavaScript
 * disabled would.
 *
 * React renders a server-action form with hidden `$ACTION_*` fields for
 * progressive enhancement. Replaying those exercises the whole path, the
 * same-origin check, the Zod parse at the boundary, the use case, the cookie
 * and the redirect, without needing a browser in the loop.
 *
 * It complements the suites rather than repeating them: `sign-in.test.ts` proves
 * the use case against real Postgres, and this proves the wiring around it,
 * which is the part a unit test cannot see.
 *
 *   pnpm smoke:signin [base-url]
 *
 * Needs a server running and the seed applied.
 */

const BASE = process.argv[2] ?? process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.SMOKE_EMAIL ?? 'doctor@blood-connect.invalid';
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'BloodConnect!Demo2026';

let failures = 0;

const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok ' : 'BAD'} ${label.padEnd(34)} ${String(actual)}`);
};

const page = await fetch(`${BASE}/sign-in`).then((r) => r.text());

/** The hidden progressive-enhancement fields, as rendered. */
const hidden = {};
for (const m of page.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/>/g)) {
  hidden[m[1]] = (m[2] ?? '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

if (Object.keys(hidden).length === 0) {
  console.error('No server-action fields found on /sign-in. Is the server running and built?');
  process.exit(1);
}

async function post(email, password, headers = {}) {
  const body = new FormData();
  for (const [k, v] of Object.entries(hidden)) body.append(k, v);
  body.append('email', email);
  body.append('password', password);

  const res = await fetch(`${BASE}/sign-in`, {
    method: 'POST',
    body,
    redirect: 'manual',
    headers: { Origin: BASE, ...headers },
  });

  const setCookie = res.headers.get('set-cookie') ?? '';
  return {
    status: res.status,
    location: res.headers.get('location'),
    token: /bc_session=([^;]+)/.exec(setCookie)?.[1],
    cookie: setCookie,
  };
}

console.log(`\nsigning in at ${BASE}`);

console.log('\ncorrect password');
const good = await post(EMAIL, PASSWORD);
check('redirects to the role landing', good.location, '/dashboard');
check('sets a session cookie', good.token !== undefined, true);
check('httpOnly', /httponly/i.test(good.cookie), true);
check('sameSite=lax', /samesite=lax/i.test(good.cookie), true);

console.log('\nwrong password');
const bad = await post(EMAIL, 'not the password');
check('no session cookie', bad.token, undefined);
check('no redirect', bad.location, null);

console.log('\nunknown address');
const unknown = await post('nobody@blood-connect.invalid', PASSWORD);
check('no session cookie', unknown.token, undefined);
check('answers like a wrong password', unknown.status, bad.status);

console.log('\ncross-origin (§3, CSRF)');
const evil = await post(EMAIL, PASSWORD, { Origin: 'http://evil.example' });
check('refused', evil.status >= 400, true);
check('no session cookie', evil.token, undefined);

if (good.token) {
  console.log('\nfollowing the cookie');
  const res = await fetch(`${BASE}/dashboard`, {
    headers: { cookie: `bc_session=${good.token}` },
    redirect: 'manual',
  });
  const body = await res.text();
  check('reaches the dashboard', res.status, 200);
  check('renders the doctor dashboard', body.includes('Doctor dashboard'), true);

  const forbidden = await fetch(`${BASE}/admin`, {
    headers: { cookie: `bc_session=${good.token}` },
    redirect: 'manual',
  });
  const forbiddenBody = await forbidden.text();
  check('is refused on /admin', forbidden.status, 403);
  // §14: the refusal must be in the body, not only in the status.
  check(
    'refusal carries no data',
    ['Doctor', 'Administration', '@blood-connect'].every((w) => !forbiddenBody.includes(w)),
    true,
  );
}

console.log(failures === 0 ? '\nall ok\n' : `\n${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
