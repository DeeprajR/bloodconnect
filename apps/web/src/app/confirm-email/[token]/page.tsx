import type { Metadata } from 'next';
import Link from 'next/link';

import { linkButtonClasses } from '@blood-connect/ui';
import { useCaseContext } from '@/lib/guards';
import { anonymousActor, confirmEmailChange } from '@blood-connect/platform';

export const metadata: Metadata = { title: 'Confirm your address · Blood Connect' };

const LINK_PRIMARY = linkButtonClasses({ variant: 'primary', size: 'lg' });

/**
 * The address-change confirmation (§3).
 *
 * Applied on open rather than behind a button. The person has already
 * made the decision, twice, once when requesting it and once by opening a
 * link that only reaches the address being claimed, and a second
 * confirmation step is a chance to abandon the flow half-done.
 *
 * Usable while signed out on purpose: the new inbox may be on a phone
 * that has never signed in, and requiring a session would strand exactly
 * that person.
 */
export default async function ConfirmEmailPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const ctx = await useCaseContext(anonymousActor);
  const result = await confirmEmailChange(ctx, token);

  return (
    <div
      id="main"
      className="flex min-h-dvh items-center justify-center bg-canvas p-6"
    >
      <div className="w-full max-w-md space-y-5">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="flex size-9 items-center justify-center rounded-control bg-primary text-base font-bold text-white"
          >
            B
          </span>
          <div>
            <p className="text-base font-semibold text-ink">Blood Connect</p>
            <p className="text-xs text-ink-subtle">Confirm your address</p>
          </div>
        </div>

        {result.ok ? (
          <div
            role="status"
            className="rounded-card border border-success/30 bg-success-soft p-4"
          >
            <h1 className="text-base font-semibold text-ink">Address changed</h1>
            <p className="mt-1 text-sm text-ink">
              Your account now uses{' '}
              <span className="font-medium">{result.value.newEmail}</span>.
              Sign in with it from now on.
            </p>
          </div>
        ) : (
          <div
            role="alert"
            className="rounded-card border border-danger/30 bg-danger-soft p-4"
          >
            <h1 className="text-base font-semibold text-danger">
              That link cannot be used
            </h1>
            <p className="mt-1 text-sm text-ink">{result.error.message}</p>
          </div>
        )}

        <Link href="/sign-in" className={LINK_PRIMARY}>
          Go to sign in
        </Link>
      </div>
    </div>
  );
}
