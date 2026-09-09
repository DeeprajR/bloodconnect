import Link from 'next/link';

import type { Actor } from '@blood-connect/platform';
import { SignOutButton } from './sign-out-button';

/**
 * The administration frame.
 *
 * Visibly a different application from the staff one — different name in the
 * header, different cookie, different port. Somebody who has both accounts
 * should never be in doubt about which system they are typing into.
 */
export function AppShell({
  actor,
  title,
  children,
  narrow = false,
}: {
  actor: Actor;
  title: string;
  children: React.ReactNode;
  narrow?: boolean;
}) {
  return (
    <div className="app-page">
      <header className="app-header">
        <div className="app-header-identity">
          <Link href="/doctors" className="ux4g-heading-xs-strong">
            Blood Connect administration
          </Link>
          <span className="ux4g-label-m-default">{title}</span>
        </div>

        {actor.kind === 'user' ? (
          <div className="app-row">
            <Link
              href="/doctors"
              className="ux4g-btn ux4g-btn-text-primary ux4g-btn-md app-target"
            >
              Doctors
            </Link>
            <Link
              href="/updates"
              className="ux4g-btn ux4g-btn-text-primary ux4g-btn-md app-target"
            >
              Update requests
            </Link>
            <SignOutButton />
          </div>
        ) : null}
      </header>

      <main id="main" className={narrow ? 'app-main app-main-narrow' : 'app-main'}>
        {children}
      </main>

      <footer className="app-footer">
        <p className="ux4g-label-s-default">
          Administration only. This application holds no clinical function and cannot
          raise or decide a blood request. Running on synthetic data.
        </p>
      </footer>
    </div>
  );
}
