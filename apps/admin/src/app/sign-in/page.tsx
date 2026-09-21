import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Card } from '@blood-connect/ui';
import { currentActor } from '@/lib/session';
import { landingFor } from '@blood-connect/platform';
import { SignInForm } from './form';

export const metadata: Metadata = { title: 'Sign in · Administration' };

/**
 * The sign-in page deliberately does NOT wrap in the app shell: an
 * unauthenticated visitor has no navigation to speak of, no identity to
 * announce, and no role-scoped chrome to render. A centred card on the
 * canvas is the whole page (ADR 0015, mirroring apps/web's sign-in).
 *
 * No "forgot your password?" link: administrator accounts are not
 * self-service (§2.2's provisioning applies here too), and the reset flow
 * the staff app offers is for clinical accounts on a different origin.
 */
export default async function SignInPage() {
  const actor = await currentActor();
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
            <p className="text-base font-semibold text-ink">
              Blood Connect administration
            </p>
            <p className="text-xs text-ink-subtle">
              Administrator accounts only. Clinical accounts sign in to the
              main application.
            </p>
          </div>
        </div>

        <Card>
          <SignInForm />
        </Card>
      </div>
    </div>
  );
}
