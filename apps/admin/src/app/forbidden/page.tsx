import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Not available · Blood Connect' };

/**
 * 403.
 *
 * This page renders **no data at all**, not the requested path, not the
 * account, not the role, not what would have been shown. §14 names the mistake
 * to avoid: a test that asserts the redirect rather than the body, passing while
 * a JSON payload rides along underneath. There is nothing here to ride along,
 * and the role-matrix test asserts exactly that.
 *
 * It does not offer a sign-in link either. The visitor is already signed in;
 * suggesting another account might work is untrue and an invitation.
 */
export default function ForbiddenPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <main id="main" className="mx-auto flex w-full max-w-md flex-1 items-center p-6">
        <div
          role="alert"
          className="w-full rounded-card border border-danger/30 bg-danger-soft p-6"
        >
          <h1 className="text-base font-semibold text-danger">Not available</h1>
          <p className="mt-2 text-sm text-ink">
            This account does not have access to this part of Blood Connect.
          </p>
        </div>
      </main>
    </div>
  );
}
