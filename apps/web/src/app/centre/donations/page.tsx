import type { Metadata } from 'next';

import { Card, PageHeader } from '@blood-connect/ui';

import { CentreShell } from '../../centre-shell';
import { CompletedDonations, UpcomingDonations } from '../../donations-tables';
import { requireAccess, useCaseContext } from '@/lib/guards';
import { listCompletedDonations, listUpcomingDonations } from '@blood-connect/centre';

export const metadata: Metadata = { title: 'Donation status · Blood Connect' };

/**
 * Every donor coming in, and everything already collected (§4, §8.3).
 *
 * The dashboard shows the next few of each; this is the whole list. Both render
 * through the same component, so the two cannot drift apart about what a
 * walk-in looks like.
 */
export default async function DonationsPage() {
  const actor = await requireAccess('/centre/donations');
  const ctx = await useCaseContext(actor);

  const [upcoming, completed] = await Promise.all([
    listUpcomingDonations(ctx, 100),
    listCompletedDonations(ctx, 100),
  ]);

  return (
    <CentreShell actor={actor} title="Donation status" current="donations">
      <PageHeader
        title="Donation status"
        description={
          // The counter is the authority on who gave blood (§4), so nothing
          // here is marked from this screen. It is marked on the roster,
          // where the donor's phone number sits beside their name.
          "Donors who have agreed to come, and the donations already recorded. Marking somebody off happens on that demand’s roster."
        }
      />

      <Card title="Coming in">
        <p className="mb-4 text-sm text-ink-muted">
          {
            // A withdrawn demand's donors are stood down by the bot, so they
            // are not people to expect. The read excludes them rather than
            // showing a list somebody has to mentally filter.
            'Confirmed donors for demands still recruiting, soonest first.'
          }
        </p>
        <UpcomingDonations rows={upcoming} />
      </Card>

      <Card title="Already given">
        <p className="mb-4 text-sm text-ink-muted">
          Roster donations and walk-ins together, newest first. A walk-in is
          somebody who gave without ever being asked by the bot.
        </p>
        <CompletedDonations rows={completed} />
      </Card>
    </CentreShell>
  );
}
