import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Not available · Blood Connect' };

/**
 * 403.
 *
 * This page renders **no data at all** — not the requested path, not the
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
    <div className="app-page">
      <main id="main" className="app-main app-main-narrow">
        <div className="ux4g-alert ux4g-alert-error" role="alert">
          <div className="ux4g-alert-content">
            <h1 className="ux4g-alert-title">Not available</h1>
            <p className="ux4g-alert-message">
              This account does not have access to this part of Blood Connect.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
