import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AppShell } from '../shell';
import { SignInForm } from '../forms';
import { currentActor } from '@/lib/session';
import { landingFor } from '@blood-connect/platform';

export const metadata: Metadata = { title: 'Sign in · Administration' };

export default async function SignInPage() {
  const actor = await currentActor();
  if (actor.kind === 'user') redirect(landingFor(actor.role));

  return (
    <AppShell actor={actor} title="Sign in" narrow>
      <div className="ux4g-card ux4g-card-outline">
        <div className="ux4g-card-header">
          <h1 className="ux4g-card-title">Administration</h1>
          <p className="ux4g-card-sub-title">
            Administrator accounts only. Clinical accounts sign in to the main
            application.
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
