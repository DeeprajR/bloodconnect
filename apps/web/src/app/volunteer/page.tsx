import type { Metadata } from 'next';

import { AppShell } from '../shell';
import { RoleHome } from '../role-home';
import { requireAccess } from '@/lib/guards';

export const metadata: Metadata = { title: 'Volunteer · Blood Connect' };

export default async function VolunteerPage() {
  const actor = await requireAccess('/volunteer');

  return (
    <AppShell actor={actor} title="Volunteer">
      <RoleHome
        actor={actor}
        heading="Volunteer dashboard"
        summary="Where the pressure is, by blood group and district. Aggregates only — no patient, no request, and no donor name reaches this surface."
        next={[
          'Eight pressure tiles: colour and number and label, never colour alone (phase 9)',
          'Open demands behind a tile (phase 9)',
          'A share message anyone can forward (phase 9)',
        ]}
      />
    </AppShell>
  );
}
