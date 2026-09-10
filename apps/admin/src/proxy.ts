import { NextResponse, type NextRequest } from 'next/server';

import { db } from '@blood-connect/platform';
import { decideAccess, nodeTokens, resolveActor } from '@blood-connect/platform';
import { AUDIENCE, SESSION_COOKIE } from '@/lib/session';

/**
 * Layer 1 of §13: route protection.
 *
 * Next 16 calls this the `proxy` convention; it was `middleware` up to 15, and
 * that name is deprecated. Proxy always runs on the Node.js runtime, which is
 * what lets this resolve the session against the database rather than merely
 * noticing that a cookie exists. A doctor cannot reach a doctor record
 * far enough to render a page.
 *
 * Proxy also allows no route-segment config, so there is no matcher: **every**
 * request reaches this function and `decideAccess` decides it. That is stricter
 * than a matcher and removes the failure it invites, where a route is added
 * without a matching pattern and quietly renders unprotected.
 *
 * This is the first of three independent checks. The page guard repeats it, and
 * the use case repeats it again, because a job or a script passes through
 * neither.
 */

/**
 * Assets, not routes. Skipped before the session lookup so a page load does not
 * pay for a database round trip per image.
 */
const SKIP =
  /^\/(?:_next\/static|_next\/image|favicon\.ico|manifest\.webmanifest|sw\.js|icons\/)/;

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (SKIP.test(pathname)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const actor = await resolveActor(
    db,
    token ? nodeTokens.fingerprint(token) : undefined,
    new Date(),
    AUDIENCE,
  );

  const decision = decideAccess(pathname, actor, AUDIENCE);
  if (decision.allowed) return NextResponse.next();

  if (decision.reason === 'unauthenticated') {
    // An API path gets a status, not a redirect: a JSON caller handed an HTML
    // sign-in page is a confusing failure, and §14 asks that a refusal be a
    // refusal in the body and not only in the location header.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    const signIn = new URL('/sign-in', request.url);
    signIn.searchParams.set('next', pathname);
    return NextResponse.redirect(signIn);
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // 403 with a page, not a redirect. §14 names "asserts the redirect rather
  // than the body" as the mistake to avoid, and the response that makes that
  // test meaningful is one carrying no data at all.
  return NextResponse.rewrite(new URL('/forbidden', request.url), { status: 403 });
}
