import type { Metadata } from 'next';
import Link from 'next/link';

import { Card } from '@blood-connect/ui';

import { CompleteResetForm, RequestResetForm } from '../forms';
import { completeResetAction, requestResetAction } from '../actions';
import { currentConfig } from '@blood-connect/platform';

export const metadata: Metadata = { title: 'Reset your password · Blood Connect' };

/**
 * Password reset in four steps (§3): enter the address, receive a
 * six-digit code, enter it, set a new password.
 *
 * Both forms are on one page rather than behind a wizard, because the
 * code arrives in a different application and coming back to a
 * half-finished flow is the normal case, not the exception. Someone who
 * already has a code can go straight to the second form.
 *
 * The rule that shapes all of it: the response to "send me a code" is
 * identical whether or not the address exists. A reset form must not
 * become an account-enumeration oracle.
 */
export default async function ResetPage() {
  const config = await currentConfig();

  return (
    <div
      id="main"
      className="flex min-h-dvh items-center justify-center bg-canvas p-6"
    >
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="flex size-9 items-center justify-center rounded-control bg-primary text-base font-bold text-white"
          >
            B
          </span>
          <div>
            <p className="text-base font-semibold text-ink">Blood Connect</p>
            <p className="text-xs text-ink-subtle">Reset your password</p>
          </div>
        </div>

        <Card title="Send me a code">
          <p className="mb-4 text-xs text-ink-subtle">
            We will email a six-digit code to the address on your account.
          </p>
          <RequestResetForm action={requestResetAction} />
        </Card>

        <Card title="I have a code">
          <p className="mb-4 text-xs text-ink-subtle">
            Setting a new password signs you in and ends every other session.
          </p>
          <CompleteResetForm
            action={completeResetAction}
            minimumLength={config.auth.minPasswordLength}
          />
        </Card>

        <div className="text-center">
          <Link
            href="/sign-in"
            className="text-sm font-medium text-primary hover:underline"
          >
            ← Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
