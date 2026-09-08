import type { Metadata } from 'next';
import Link from 'next/link';

import { AppShell } from '../shell';
import { CompleteResetForm, RequestResetForm } from '../forms';
import { completeResetAction, requestResetAction } from '../actions';
import { currentActor } from '@/lib/session';
import { currentConfig } from '@blood-connect/platform';

export const metadata: Metadata = { title: 'Reset your password · Blood Connect' };

/**
 * Password reset in four steps (§3): enter the address, receive a six-digit
 * code, enter it, set a new password.
 *
 * Both forms are on one page rather than behind a wizard, because the code
 * arrives in a different application and coming back to a half-finished flow is
 * the normal case, not the exception. Someone who already has a code can go
 * straight to the second form.
 *
 * The rule that shapes all of it: the response to "send me a code" is identical
 * whether or not the address exists. A reset form must not become an
 * account-enumeration oracle.
 */
export default async function ResetPage() {
  const actor = await currentActor();
  const config = await currentConfig();

  return (
    <AppShell actor={actor} title="Reset your password" narrow>
      <div className="ux4g-card ux4g-card-outline">
        <div className="ux4g-card-header">
          <h1 className="ux4g-card-title">Send me a code</h1>
          <p className="ux4g-card-sub-title">
            We will email a six-digit code to the address on your account.
          </p>
        </div>
        <div className="ux4g-card-body">
          <RequestResetForm action={requestResetAction} />
        </div>
      </div>

      <div className="ux4g-card ux4g-card-outline">
        <div className="ux4g-card-header">
          <h2 className="ux4g-card-title">I have a code</h2>
          <p className="ux4g-card-sub-title">
            Setting a new password signs you in and ends every other session.
          </p>
        </div>
        <div className="ux4g-card-body">
          <CompleteResetForm
            action={completeResetAction}
            minimumLength={config.auth.minPasswordLength}
          />
        </div>
      </div>

      <Link className="ux4g-btn ux4g-btn-text-primary ux4g-btn-md" href="/sign-in">
        Back to sign in
      </Link>
    </AppShell>
  );
}
