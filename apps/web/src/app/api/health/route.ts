import { NextResponse } from 'next/server';

import { db } from '@blood-connect/platform';
import { sql } from 'drizzle-orm';

/**
 * The load balancer's endpoint (§11.9, P10).
 *
 * **Shallow, unauthenticated, and deliberately uninformative.** It answers one
 * question, "should traffic keep coming here", and it answers it with a status
 * code and one word.
 *
 * It is kept separate from the control panel on purpose. The panel enumerates
 * every dependency, its version and its last error, and a public endpoint that
 * did the same would be a reconnaissance endpoint: it would tell an anonymous
 * caller which object store this deployment uses, which mail provider, and
 * which of them is currently broken.
 *
 * One database round trip and nothing else. A process that cannot reach its
 * database cannot serve a request, and every other dependency degrades a
 * feature rather than the deployment.
 */

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({ status: 'ok' }, { status: 200 });
  } catch {
    // No detail, not even here. Whoever is on call reads the panel; whoever is
    // scanning gets a number.
    return NextResponse.json({ status: 'unavailable' }, { status: 503 });
  }
}
