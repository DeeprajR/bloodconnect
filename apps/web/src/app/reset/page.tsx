import type { Metadata } from 'next';
import Link from 'next/link';

import { AppShell } from '../shell';
import { currentActor } from '@/lib/session';

export const metadata: Metadata = { title: 'Reset your password · Blood Connect' };

/**
 * Password reset — public, and built in phase 5 (§3, §8.1).
 *
 * The route exists now because the sign-in page links to it and a link to
 * nowhere is exactly the dead end §8 exists to prevent. What lands here has
 * four steps and one rule that shapes all of them: the response to "send me an
 * OTP" is identical whether or not the address exists.
 */
export default async function ResetPage() {
  const actor = await currentActor();

  return (
    <AppShell actor={actor} title="Reset your password" narrow>
      <div className="ux4g-card ux4g-card-outline">
        <div className="ux4g-card-header">
          <h1 className="ux4g-card-title">Reset your password</h1>
        </div>
        <div className="ux4g-card-body">
          <p className="ux4g-body-m-default">
            Self-service reset is not available yet. Ask your administrator to re-send your
            invite, which sets a new password and signs you in.
          </p>
        </div>
        <div className="ux4g-card-footer">
          <Link className="ux4g-btn ux4g-btn-text-primary ux4g-btn-md" href="/sign-in">
            Back to sign in
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
