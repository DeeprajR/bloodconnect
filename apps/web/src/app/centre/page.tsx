import type { Metadata } from 'next';

import { AppShell } from '../shell';
import { RoleHome } from '../role-home';
import { requireAccess } from '@/lib/guards';

export const metadata: Metadata = { title: 'Blood centre · Blood Connect' };

export default async function CentrePage() {
  const actor = await requireAccess('/centre');

  return (
    <AppShell actor={actor} title="Blood centre">
      <RoleHome
        actor={actor}
        heading="Blood centre"
        summary="Answer requests from stock, and turn what the shelf cannot cover into demand — in the same transaction, so a shortfall can never exist without its demand row."
        next={[
          'Tag intake and the inventory register (phase 3)',
          'The request queue, with stock on hand per group (phase 3)',
          'Returns, quarantine and discards (phase 6)',
          'Camera calibration, shadow mode only (phase 11)',
        ]}
      />
    </AppShell>
  );
}
