import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AppShell } from '../shell';
import { currentActor } from '@/lib/session';
import { landingFor } from '@blood-connect/platform';
import { SignInForm } from './form';

export const metadata: Metadata = { title: 'Sign in · Blood Connect' };

/**
 * Accounts are provisioned by an administrator; there is no sign-up page
 * (§2.2). A first sign-in happens on the emailed invite link, which is P5,
 * until then the seed script is the only way an account comes into being, and
 * that is the spec's own sanctioned path.
 */
export default async function SignInPage() {
  const actor = await currentActor();

  // Already signed in: send them where they were going rather than showing a
  // form for an account they are already using.
  if (actor.kind === 'user') redirect(landingFor(actor.role));

  return (
    <AppShell actor={actor} title="Sign in" narrow>
      <div className="ux4g-card ux4g-card-outline">
        <div className="ux4g-card-header">
          <h1 className="ux4g-card-title">Sign in</h1>
          <p className="ux4g-card-sub-title">
            Use the account your administrator created for you.
          </p>
        </div>

        <div className="ux4g-card-body">
          <SignInForm />
        </div>

        <div className="ux4g-card-footer">
          <Link className="ux4g-btn ux4g-btn-text-primary ux4g-btn-md" href="/reset">
            Forgot your password?
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
