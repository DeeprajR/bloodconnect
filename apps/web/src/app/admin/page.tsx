import type { Metadata } from 'next';

import { AppShell } from '../shell';
import { RoleHome } from '../role-home';
import { requireAccess } from '@/lib/guards';

export const metadata: Metadata = { title: 'Administration · Blood Connect' };

export default async function AdminPage() {
  const actor = await requireAccess('/admin');

  return (
    <AppShell actor={actor} title="Administration">
      <RoleHome
        actor={actor}
        heading="Administration"
        summary="Provision and deactivate accounts, change roles, and work the account-update queue. Nobody approves their own request, and the last active administrator cannot be demoted."
        next={[
          'Create an account and send its invite (phase 5)',
          'The account-update request queue (phase 5)',
          'Accounts ageing unactivated, surfaced rather than left to rot (phase 5)',
          'Clinical thresholds, edited as configuration (phase 5)',
        ]}
      />
    </AppShell>
  );
}
