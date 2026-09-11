import type { Metadata } from 'next';

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
      <div className="app-stack-tight">
        <h1 className="ux4g-heading-l-strong">Donation status</h1>
        <p className="ux4g-body-m-default">
          {/*
            The counter is the authority on who gave blood (§4), so nothing here
            is marked from this screen. It is marked on the demand's own donor
            list, where the phone number sits beside the name.
          */}
          Donors who have agreed to come, and the donations already recorded. Marking
          somebody off happens on that demand&rsquo;s donor list.
        </p>
      </div>

      <section className="ux4g-card ux4g-card-outline" aria-labelledby="coming-in">
        <div className="ux4g-card-header">
          <h2 className="ux4g-card-title" id="coming-in">
            Coming in
          </h2>
          <p className="ux4g-card-sub-title">
            {/*
              A withdrawn demand's donors are stood down by the bot, so they are
              not people to expect. The read excludes them rather than showing
              a list somebody has to mentally filter.
            */}
            Confirmed donors for demands still recruiting, soonest first.
          </p>
        </div>
        <div className="ux4g-card-body">
          <UpcomingDonations rows={upcoming} />
        </div>
      </section>

      <section className="ux4g-card ux4g-card-outline" aria-labelledby="already-given">
        <div className="ux4g-card-header">
          <h2 className="ux4g-card-title" id="already-given">
            Already given
          </h2>
          <p className="ux4g-card-sub-title">
            Donors we asked and people who simply came in, together, newest first.
            A walk-in is somebody who gave without ever being asked by the bot.
          </p>
        </div>
        <div className="ux4g-card-body">
          <CompletedDonations rows={completed} />
        </div>
      </section>
    </CentreShell>
  );
}
