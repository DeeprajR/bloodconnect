import type { Metadata } from 'next';

import { AppShell } from '../shell';
import { RoleHome } from '../role-home';
import { requireAccess } from '@/lib/guards';

export const metadata: Metadata = { title: 'Dashboard · Blood Connect' };

export default async function DashboardPage() {
  // Layer 2 of §13. The middleware already decided this; the page decides it
  // again, because a route can be added without a matcher and a page that
  // renders when the matcher is wrong is a page that leaks.
  const actor = await requireAccess('/dashboard');

  return (
    <AppShell actor={actor} title="Dashboard">
      <RoleHome
        actor={actor}
        heading="Doctor dashboard"
        summary="Identify the admitted patient, fill the request, submit it, and get an ID back. The answer from the centre comes back to this screen."
        next={[
          'Patients and admissions (phase 2)',
          'Request drafts, review and submit (phase 2)',
          'Crossmatch sample association (phase 5)',
          'Drafts ageing visibly, never auto-deleted (phase 5)',
        ]}
      />
    </AppShell>
  );
}
