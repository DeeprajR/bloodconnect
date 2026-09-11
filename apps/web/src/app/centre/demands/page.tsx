import type { Metadata } from 'next';
import Link from 'next/link';

import { CentreShell } from '../../centre-shell';
import { LiveRefresh } from '../../volunteer/live';
import { CancelDemandForm } from '../../centre-forms';
import { requireAccess, useCaseContext } from '@/lib/guards';
import { countUnmarked, listDemands } from '@blood-connect/centre';
import { WORDING, bloodGroupLabel, productLabel } from '@blood-connect/domain';

export const metadata: Metadata = { title: 'Demand · Blood Connect' };

const STATUS_LABELS: Readonly<Record<string, string>> = {
  open: 'Open',
  fulfilled: 'Enough donors confirmed',
  completed: 'Completed',
  cancelled: 'Withdrawn',
  expired: 'Expired',
};

export default async function DemandsPage() {
  const actor = await requireAccess('/centre/demands');
  const ctx = await useCaseContext(actor);

  const demands = await listDemands(ctx);
  const open = demands.filter((row) => row.status === 'open' || row.status === 'fulfilled');
  const closed = demands.filter((row) => !open.includes(row));

  // How many confirmed donors are still waiting to be marked at the counter.
  // It is the number that decides whether anybody needs to open the donor list.
  const unmarked = new Map(
    await Promise.all(
      open.map(async (demand) => [demand.id, await countUnmarked(ctx, demand.id)] as const),
    ),
  );

  /**
   * Picked up by the bot, and nobody contacted.
   *
   * The one recruitment failure that looks exactly like success from here: the
   * demand is open, the bot imported it, the counter waits, and no phone ever
   * rings. It means the pool holds nobody who can answer this group today, and
   * saying so beats leaving somebody to conclude the bot is broken.
   */
  const silent = open.filter(
    (row) => row.botPublicId !== null && row.donorsNotified === 0,
  );

  const day = new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  });

  return (
    <CentreShell actor={actor} title="Demand">
      {/* The counters here are written back by the bot, so they move on their own. */}
      <LiveRefresh everySeconds={30} />

      <div className="app-stack-tight">
        <h1 className="ux4g-heading-l-strong">{WORDING.donorDemand}</h1>
        <p className="ux4g-body-m-default">
          {/*
            The counters are the bot's columns; the centre holds no grant on them
            (§5.1). What is shown here is written back, not calculated here.
          */}
          Progress is written back by the donor bot as people are contacted and
          confirm. A demand with no public identifier has not been picked up yet,
          and nobody has been contacted for it.
        </p>
      </div>

      {silent.length > 0 ? (
        <div className="ux4g-alert ux4g-alert-warning" role="status">
          <div className="ux4g-alert-content">
            <p className="ux4g-alert-message">
              {silent.length}{' '}
              {silent.length === 1 ? 'demand has' : 'demands have'} been picked up by
              the donor bot with nobody contacted yet.
            </p>
            <p className="ux4g-body-s-default">
              {/*
                Said on the screen rather than left in the specification, because
                this is where somebody stands wondering why the phones are quiet.
                Every reason listed is one the counter can act on or plan around.
              */}
              Nobody in the donor pool can answer this group today. Either no
              registered donor has a matching group nearby, or the ones who do gave
              recently and are still inside the gap between donations. It is not a
              fault: the list refills as people become due again.
            </p>
          </div>
        </div>
      ) : null}

      <section className="ux4g-card ux4g-card-outline" aria-labelledby="open">
        <div className="ux4g-card-header">
          <h2 className="ux4g-card-title" id="open">
            Recruiting now
          </h2>
        </div>
        <div className="ux4g-card-body app-scroll-x">
          {open.length === 0 ? (
            <p className="ux4g-body-s-default">No recruitment in progress.</p>
          ) : (
            <table className="ux4g-table">
              <thead>
                <tr>
                  <th scope="col">Group</th>
                  <th scope="col">{WORDING.product}</th>
                  <th scope="col">Units</th>
                  <th scope="col">Raised by</th>
                  <th scope="col">{WORDING.neededBy}</th>
                  <th scope="col">Notified</th>
                  <th scope="col">Confirmed</th>
                  <th scope="col">Status</th>
                  <th scope="col">Counter</th>
                  <th scope="col">
                    <span className="app-sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {open.map((demand) => (
                  <tr key={demand.id}>
                    <td className="app-figure">
                      {bloodGroupLabel(demand.bloodGroup as never)}
                    </td>
                    <td>{productLabel(demand.product as never)}</td>
                    <td className="app-figure">{demand.units}</td>
                    <td>
                      {demand.trigger === 'stock_floor'
                        ? WORDING.stockFloor
                        : 'Request shortfall'}
                    </td>
                    <td className="app-figure">{demand.dateRequired}</td>
                    <td className="app-figure">
                      {demand.botPublicId === null ? (
                        <span className="ux4g-label-m-default">not picked up</span>
                      ) : (
                        demand.donorsNotified
                      )}
                    </td>
                    <td className="app-figure">
                      {demand.confirmedUnits} / {demand.units}
                      {demand.waitlistedUnits > 0 ? (
                        <span className="ux4g-label-m-default">
                          {' '}
                          (+{demand.waitlistedUnits} waiting)
                        </span>
                      ) : null}
                    </td>
                    <td>{STATUS_LABELS[demand.status] ?? demand.status}</td>
                    <td>
                      <Link
                        className="ux4g-btn ux4g-btn-outline-primary ux4g-btn-md app-target"
                        href={`/centre/demands/${demand.id}`}
                      >
                        Donors
                        {(unmarked.get(demand.id) ?? 0) > 0 ? (
                          <span className="app-figure"> ({unmarked.get(demand.id)})</span>
                        ) : null}
                      </Link>
                    </td>
                    <td>
                      <CancelDemandForm demandId={demand.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {closed.length > 0 ? (
        <section className="ux4g-card ux4g-card-outline" aria-labelledby="closed">
          <div className="ux4g-card-header">
            <h2 className="ux4g-card-title" id="closed">
              Closed
            </h2>
          </div>
          <div className="ux4g-card-body app-scroll-x">
            <table className="ux4g-table">
              <thead>
                <tr>
                  <th scope="col">Group</th>
                  <th scope="col">Units</th>
                  <th scope="col">Completed</th>
                  <th scope="col">Status</th>
                  <th scope="col">Raised</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((demand) => (
                  <tr key={demand.id}>
                    <td className="app-figure">
                      {bloodGroupLabel(demand.bloodGroup as never)}
                    </td>
                    <td className="app-figure">{demand.units}</td>
                    <td className="app-figure">{demand.completedUnits}</td>
                    <td>{STATUS_LABELS[demand.status] ?? demand.status}</td>
                    <td className="app-figure">{day.format(demand.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <p className="ux4g-label-m-default">
        {/*
          Donor names live one click away, not on this list (§2.10). The counter
          needs them; a page showing every demand ever raised does not.
        */}
        Donor names and numbers sit behind the Donors button on each row, where
        somebody is calling a name at a desk, not on this list.
      </p>

      <Link className="ux4g-btn ux4g-btn-text-neutral ux4g-btn-md" href="/centre">
        Back to the overview
      </Link>
    </CentreShell>
  );
}
