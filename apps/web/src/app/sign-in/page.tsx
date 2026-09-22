import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Card } from '@blood-connect/ui';
import { currentActor } from '@/lib/session';
import { landingFor } from '@blood-connect/platform';
import { SignInForm } from './form';

export const metadata: Metadata = { title: 'Sign in · Blood Connect' };

/**
 * Accounts are provisioned by an administrator; there is no sign-up page
 * (§2.2). A first sign-in happens on the emailed invite link, which is P5,
 * until then the seed script is the only way an account comes into being, and
 * that is the spec's own sanctioned path.
 *
 * The sign-in page deliberately does NOT wrap in the app shell: an
 * unauthenticated visitor has no navigation to speak of, no identity to
 * announce, and no role-scoped chrome to render. A centred card on the canvas
 * is the whole page. This is also the first screen restyled with the
 * `@blood-connect/ui` kit (ADR 0015) — the rest of the app still ships UX4G
 * chrome, so the two coexist in this transitional PR.
 */
export default async function SignInPage() {
  const actor = await currentActor();

  // Already signed in: send them where they were going rather than showing a
  // form for an account they are already using.
  if (actor.kind === 'user') redirect(landingFor(actor.role));

  return (
    <div
      id="main"
      className="flex min-h-dvh items-center justify-center bg-canvas p-6"
    >
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="flex size-9 items-center justify-center rounded-control bg-primary text-base font-bold text-white"
          >
            B
          </span>
          <div>
            <p className="text-base font-semibold text-ink">Blood Connect</p>
            <p className="text-xs text-ink-subtle">Staff sign in</p>
          </div>
        </div>

        <Card>
          <SignInForm />
        </Card>

        <div className="text-center text-sm">
          <Link
            href="/reset"
            className="font-medium text-primary hover:underline"
          >
            Forgot your password?
          </Link>
        </div>
      </div>
    </div>
  );
}
