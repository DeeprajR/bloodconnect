import type { Metadata } from 'next';
import Link from 'next/link';

import { currentActor } from '@/lib/session';
import { landingFor } from '@blood-connect/platform';

export const metadata: Metadata = { title: 'Blood Connect' };

/**
 * The landing page. Public (§9's role matrix, row one).
 *
 * Two doors and nothing else: the board anyone may read, and the sign-in
 * for people with an account. A landing page that explains the system at
 * length is a landing page nobody in a hurry reads.
 *
 * No app shell here, even for signed-in visitors: the shell needs a role
 * to render a nav rail, and this page is one of the two the anonymous
 * matrix row reaches. Signed-in visitors get a "Continue" button that
 * lands them where their role usually goes.
 */
export default async function LandingPage() {
  const actor = await currentActor();

  const linkPrimary =
    'inline-flex h-11 items-center justify-center gap-2 rounded-control ' +
    'border border-transparent bg-primary px-5 text-sm font-medium text-white ' +
    'transition-colors hover:bg-primary-hover focus-visible:outline ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2';
  const linkSecondary =
    'inline-flex h-11 items-center justify-center gap-2 rounded-control ' +
    'border border-border-strong bg-surface px-5 text-sm font-medium text-ink ' +
    'transition-colors hover:bg-surface-muted focus-visible:outline ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2';

  return (
    <div
      id="main"
      className="flex min-h-dvh items-center justify-center bg-canvas p-6"
    >
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-control bg-primary text-lg font-bold text-white">
          B
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            Blood Connect
          </h1>
          <p className="text-sm text-ink-muted">
            Blood requests, centre inventory and donor recruitment for a
            medical-college hospital.
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:justify-center">
          {actor.kind === 'user' ? (
            <Link className={linkPrimary} href={landingFor(actor.role)}>
              Continue
            </Link>
          ) : (
            <Link className={linkPrimary} href="/sign-in">
              Sign in
            </Link>
          )}
          <Link className={linkSecondary} href="/board">
            Open demand board
          </Link>
        </div>
      </div>
    </div>
  );
}
