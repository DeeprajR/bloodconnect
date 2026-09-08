import type { Metadata } from 'next';
import Link from 'next/link';

import { AppShell } from '../../shell';
import { CancelDemandForm } from '../../centre-forms';
import { requireAccess, useCaseContext } from '@/lib/guards';
import { listDemands } from '@blood-connect/centre';
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

  const day = new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  });

  return (
    <AppShell actor={actor} title="Demand">
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
          The roster and the counter outcomes are P4/P6 work. Naming what is
          missing beats a screen that looks finished.
        */}
        The confirmed-donor roster, and marking each donor donated, no-show or
        cancelled at the counter, arrive with the bot in a later phase.
      </p>

      <Link className="ux4g-btn ux4g-btn-text-neutral ux4g-btn-md" href="/centre">
        Back to the overview
      </Link>
    </AppShell>
  );
}
