import type { Metadata } from 'next';
import Link from 'next/link';

import { AppShell } from '../../shell';
import { currentActor } from '@/lib/session';
import { useCaseContext } from '@/lib/guards';
import { anonymousActor, confirmEmailChange } from '@blood-connect/platform';

export const metadata: Metadata = { title: 'Confirm your address · Blood Connect' };

/**
 * The address-change confirmation (§3).
 *
 * Applied on open rather than behind a button. The person has already made the
 * decision — twice, once when requesting it and once by opening a link that
 * only reaches the address being claimed — and a second confirmation step is a
 * chance to abandon the flow half-done.
 *
 * Usable while signed out on purpose: the new inbox may be on a phone that has
 * never signed in, and requiring a session would strand exactly that person.
 */
export default async function ConfirmEmailPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const actor = await currentActor();

  const ctx = await useCaseContext(anonymousActor);
  const result = await confirmEmailChange(ctx, token);

  return (
    <AppShell actor={actor} title="Confirm your address" narrow>
      {result.ok ? (
        <div className="ux4g-alert ux4g-alert-success" role="status">
          <div className="ux4g-alert-content">
            <h1 className="ux4g-alert-title">Address changed</h1>
            <p className="ux4g-alert-message">
              Your account now uses {result.value.newEmail}. Sign in with it from now on.
            </p>
          </div>
        </div>
      ) : (
        <div className="ux4g-alert ux4g-alert-error" role="alert">
          <div className="ux4g-alert-content">
            <h1 className="ux4g-alert-title">That link cannot be used</h1>
            <p className="ux4g-alert-message">{result.error.message}</p>
          </div>
        </div>
      )}

      <Link className="ux4g-btn ux4g-btn-primary ux4g-btn-lg app-target" href="/sign-in">
        Go to sign in
      </Link>
    </AppShell>
  );
}
