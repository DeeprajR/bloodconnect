import Link from 'next/link';

import type { Actor, UserRole } from '@/modules/platform';
import { SignOutButton } from './sign-out-button';

const ROLE_LABELS: Readonly<Record<UserRole, string>> = {
  doctor: 'Doctor',
  admin: 'Administrator',
  blood_centre: 'Blood centre',
  volunteer_admin: 'Volunteer admin',
};

/**
 * The application frame.
 *
 * Deliberately thin. The spec's non-functional rules ask for one filled primary
 * action per screen and a single column of content (§10), and a heavy chrome
 * competes with both. What belongs in a header here is who you are signed in as
 * — because the same screens behave differently by role, and a doctor who
 * thinks they are looking at the centre's queue will misread it.
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
          <Link href="/" className="ux4g-heading-xs-strong">
            Blood Connect
          </Link>
          <span className="ux4g-label-m-default">{title}</span>
        </div>

        {actor.kind === 'user' ? (
          <div className="app-row">
            <span className="ux4g-label-m-default">{ROLE_LABELS[actor.role]}</span>
            <SignOutButton />
          </div>
        ) : (
          <Link
            href="/sign-in"
            className="ux4g-btn ux4g-btn-outline-primary ux4g-btn-md app-target"
          >
            Sign in
          </Link>
        )}
      </header>

      <main id="main" className={narrow ? 'app-main app-main-narrow' : 'app-main'}>
        {children}
      </main>

      <footer className="app-footer">
        {/*
         * The medical disclaimer stays prominent regardless of the audience
         * (§12.6), and the synthetic-data statement is a property to state
         * plainly rather than a limitation to apologise for.
         */}
        <p className="ux4g-label-s-default">
          Not a medical device. This system does not make clinical decisions; the
          pre-donation assessment and the pre-transfusion compatibility test always happen
          on site. Running on synthetic data — no real patient or donor record.
        </p>
      </footer>
    </div>
  );
}
