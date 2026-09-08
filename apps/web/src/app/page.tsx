import type { Metadata } from 'next';
import Link from 'next/link';

import { AppShell } from './shell';
import { currentActor } from '@/lib/session';
import { landingFor } from '@blood-connect/platform';

export const metadata: Metadata = { title: 'Blood Connect' };

/**
 * The landing page — public (§9's role matrix, row one).
 *
 * Two doors and nothing else: the board anyone may read, and the sign-in for
 * people with an account. A landing page that explains the system at length is
 * a landing page nobody in a hurry reads.
 */
export default async function LandingPage() {
  const actor = await currentActor();

  return (
    <AppShell actor={actor} title="" narrow>
      <div className="app-stack-tight">
        <h1 className="ux4g-heading-l-strong">Blood Connect</h1>
        <p className="ux4g-body-m-default">
          Blood requests, centre inventory and donor recruitment for a medical-college
          hospital.
        </p>
      </div>

      <div className="app-row">
        {actor.kind === 'user' ? (
          <Link
            className="ux4g-btn ux4g-btn-primary ux4g-btn-lg app-target"
            href={landingFor(actor.role)}
          >
            Continue
          </Link>
        ) : (
          <Link
            className="ux4g-btn ux4g-btn-primary ux4g-btn-lg app-target"
            href="/sign-in"
          >
            Sign in
          </Link>
        )}

        <Link
          className="ux4g-btn ux4g-btn-outline-primary ux4g-btn-lg app-target"
          href="/board"
        >
          Open demand board
        </Link>
      </div>
    </AppShell>
  );
}
