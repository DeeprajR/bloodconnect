import type { Metadata } from 'next';
import Link from 'next/link';

import { CentreShell } from '../centre-shell';
import { RecruitButton } from '../centre-forms';
import { StockChart } from '../stock-chart';
import { CompletedDonations, UpcomingDonations } from '../donations-tables';
import { recruitForFloorAction } from '../centre-actions';
import { requireAccess, useCaseContext } from '@/lib/guards';
import {
  centreOverviewCounts,
  listCompletedDonations,
  listDemands,
  listOpenDiscrepancies,
  listQuarantine,
  listUpcomingDonations,
  stockByGroup,
} from '@blood-connect/centre';
import { listRequestsAwaitingDecision } from '@blood-connect/hospital';
import { STOCK_DISPLAY_ORDER, WORDING, bloodGroupLabel } from '@blood-connect/domain';

export const metadata: Metadata = { title: 'Blood centre · Blood Connect' };

export default async function CentrePage() {
  const actor = await requireAccess('/centre');
  const ctx = await useCaseContext(actor);

  const [stock, queue, demands, counts, quarantined, discrepancies, upcoming, completed] =
    await Promise.all([
      stockByGroup(ctx),
      listRequestsAwaitingDecision(ctx),
      listDemands(ctx, true),
      centreOverviewCounts(ctx),
      listQuarantine(ctx),
      listOpenDiscrepancies(ctx),
      listUpcomingDonations(ctx, 5),
      listCompletedDonations(ctx, 5),
    ]);

  const today = ctx.clock.today();
  const short = stock.filter((row) => row.short > 0);

  /**
   * Shown in the clinical order, chart and table alike.
   *
   * `stockByGroup` returns storage order. Ordering only the chart would leave
   * the table under it disagreeing with the bars directly above, which is worse
   * than either order on its own.
   */
  const byGroup = new Map(stock.map((row) => [row.bloodGroup, row]));
  const shelf = STOCK_DISPLAY_ORDER.map((group) => byGroup.get(group)).filter(
    (row) => row !== undefined,
  );
  const overdue = queue.filter((row) => row.dateRequired < today);

  return (
    <CentreShell actor={actor} title="Blood centre" current="dashboard">
      <div className="app-row-split">
        <div className="app-stack-tight">
          <h1 className="ux4g-heading-l-strong">Overview</h1>
          <p className="ux4g-body-m-default">
            Answer requests from stock. Whatever the shelf cannot cover becomes demand
            for real donors, in the same transaction.
          </p>
        </div>
        <Link className="ux4g-btn ux4g-btn-primary ux4g-btn-md app-target" href="/centre/requests">
          {queue.length === 0 ? 'Request queue' : `Answer ${queue.length} waiting`}
        </Link>
      </div>

      {discrepancies.length > 0 ? (
        <div className="ux4g-alert ux4g-alert-error" role="alert">
          <div className="ux4g-alert-content">
            <p className="ux4g-alert-message">
              {/*
                §4: a discrepancy never clears itself, so it is the one alarm on
                this page that stays until a person has physically looked.
              */}
              {discrepancies.length} open tag{' '}
              {discrepancies.length === 1 ? 'discrepancy' : 'discrepancies'}. Until each is
              closed, two units may carry the same tag.{' '}
              <Link href="/centre/tags">Open them</Link>.
            </p>
          </div>
        </div>
      ) : null}

      {overdue.length > 0 ? (
        <div className="ux4g-alert ux4g-alert-error" role="alert">
          <div className="ux4g-alert-content">
            <p className="ux4g-alert-message">
              {overdue.length} {overdue.length === 1 ? 'request is' : 'requests are'} past
              the day the blood was needed.{' '}
              <Link href="/centre/requests">Open the queue</Link>.
            </p>
          </div>
        </div>
      ) : null}

      <section className="ux4g-card ux4g-card-outline" aria-labelledby="stock">
        <div className="ux4g-card-header">
          <h2 className="ux4g-card-title" id="stock">
            {WORDING.stockOnHand} against the {WORDING.stockFloor.toLowerCase()}
          </h2>
          <p className="ux4g-card-sub-title">
            {/*
              Red cells only, and the reason is worth stating on the screen: a
              floor met by plasma would read as comfortable while there was
              nothing a walk-in donor could replace.
            */}
            Whole blood and packed red cells. The components a donor can actually
            replace. Reserved units are excluded; they belong to a decision already
            made.
          </p>
        </div>
        <div className="ux4g-card-body app-stack">
          {/*
            The picture first, then the numbers behind it. The chart answers
            "which groups need donors tonight" at a glance; the table below is
            what somebody reads once they know which row to look at.
          */}
          <StockChart
            rows={shelf}
            fractions={{
              low: ctx.config.stock.lowFraction,
              critical: ctx.config.stock.criticalFraction,
            }}
          />

          <div className="app-scroll-x">
          <table className="ux4g-table">
            <thead>
              <tr>
                <th scope="col">Group</th>
                <th scope="col">On the shelf</th>
                <th scope="col">Reserved</th>
                <th scope="col">Floor</th>
                <th scope="col">Short by</th>
                <th scope="col">Expiring within 7 days</th>
              </tr>
            </thead>
            <tbody>
              {shelf.map((row) => (
                <tr key={row.bloodGroup}>
                  <td className="app-figure">{bloodGroupLabel(row.bloodGroup)}</td>
                  <td className="app-figure">{row.onShelf}</td>
                  <td className="app-figure">{row.reserved}</td>
                  <td className="app-figure">{row.floor}</td>
                  <td className="app-figure">
                    {row.short > 0 ? (
                      <span className="ux4g-badge-digit-danger">{row.short}</span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="app-figure">
                    {row.expiringSoon > 0 ? row.expiringSoon : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
        <div className="ux4g-card-footer app-stack-tight">
          <form action={recruitForFloorAction}>
            <RecruitButton shortGroups={short.length} />
          </form>
          <p className="ux4g-label-m-default">
            {/* The partial unique index makes this safe to press twice (§5.6). */}
            One demand per short group. A group that already has an open floor
            demand is skipped, so pressing this twice recruits nobody twice.
          </p>
        </div>
      </section>

      {/*
        Second section, and the other half of the day's work: the shelf above,
        the people who fill it here.
      */}
      <section className="ux4g-card ux4g-card-outline" aria-labelledby="donations">
        <div className="ux4g-card-header app-row-split">
          <div className="app-stack-tight">
            <h2 className="ux4g-card-title" id="donations">
              Donations
            </h2>
            <p className="ux4g-card-sub-title">
              Donors expected at the counter, and what has already been collected.
            </p>
          </div>
          <Link className="ux4g-btn ux4g-btn-text-primary ux4g-btn-md" href="/centre/donations">
            All donations
          </Link>
        </div>

        <div className="ux4g-card-body app-stack">
          <div className="app-stack-tight">
            <h3 className="ux4g-label-l-strong">Coming in</h3>
            <UpcomingDonations rows={upcoming} />
          </div>

          <div className="app-stack-tight">
            <h3 className="ux4g-label-l-strong">Already given</h3>
            <CompletedDonations rows={completed} />
          </div>
        </div>
      </section>

      <div className="app-grid">
        <section className="ux4g-card ux4g-card-outline">
          <div className="ux4g-card-header">
            <h2 className="ux4g-card-title">Recruitment in progress</h2>
          </div>
          <div className="ux4g-card-body app-stack-tight">
            <p className="ux4g-body-m-default">
              <span className="app-figure">{counts.openDemands}</span> open{' '}
              {counts.openDemands === 1 ? 'demand' : 'demands'}.
            </p>
            {counts.awaitingImport > 0 ? (
              <p className="ux4g-label-m-default">
                {/*
                  The bot polls for these. Until it runs, "raised" and "donors
                  contacted" are different things, and the screen says so.
                */}
                <span className="app-figure">{counts.awaitingImport}</span> not yet picked
                up by the donor bot. Nobody has been contacted for those.
              </p>
            ) : null}
            <Link className="ux4g-btn ux4g-btn-text-primary ux4g-btn-md" href="/centre/demands">
              Open demands
            </Link>
          </div>
        </section>

        <section className="ux4g-card ux4g-card-outline">
          <div className="ux4g-card-header">
            <h2 className="ux4g-card-title">The register</h2>
          </div>
          <div className="ux4g-card-body app-stack-tight">
            <p className="ux4g-body-m-default">
              <span className="app-figure">{counts.reservedBags}</span> units reserved
              against a decision.
            </p>
            {quarantined.length > 0 ? (
              <p className="ux4g-label-m-default">
                {/*
                  Quarantine is a waiting room, and a waiting room nobody can see
                  is where units are forgotten (§4).
                */}
                <span className="app-figure">{quarantined.length}</span> in{' '}
                {WORDING.quarantine.toLowerCase()}, waiting for a decision
                {quarantined.some((row) => row.overdue) ? ', some overdue' : ''}.
              </p>
            ) : null}
            <div className="app-row">
              <Link
                className="ux4g-btn ux4g-btn-outline-primary ux4g-btn-md app-target"
                href="/centre/stock/new"
              >
                Register a bag
              </Link>
              <Link
                className="ux4g-btn ux4g-btn-outline-primary ux4g-btn-md app-target"
                href="/centre/tags"
              >
                Scan a tag
              </Link>
              <Link className="ux4g-btn ux4g-btn-text-primary ux4g-btn-md" href="/centre/stock">
                View stock
              </Link>
              <Link
                className="ux4g-btn ux4g-btn-text-primary ux4g-btn-md"
                href="/centre/quarantine"
              >
                {WORDING.quarantine}
              </Link>
            </div>
          </div>
        </section>
      </div>

      {demands.length > 0 ? (
        <section className="ux4g-card ux4g-card-outline" aria-labelledby="open-demands">
          <div className="ux4g-card-header">
            <h2 className="ux4g-card-title" id="open-demands">
              Open {WORDING.donorDemand.toLowerCase()}
            </h2>
          </div>
          <div className="ux4g-card-body app-scroll-x">
            <table className="ux4g-table">
              <thead>
                <tr>
                  <th scope="col">Group</th>
                  <th scope="col">Units</th>
                  <th scope="col">Raised by</th>
                  <th scope="col">Notified</th>
                  <th scope="col">Confirmed</th>
                </tr>
              </thead>
              <tbody>
                {demands.slice(0, 8).map((demand) => (
                  <tr key={demand.id}>
                    <td className="app-figure">{demand.bloodGroup}</td>
                    <td className="app-figure">{demand.units}</td>
                    <td>
                      {demand.trigger === 'stock_floor' ? 'Stock floor' : 'Request shortfall'}
                    </td>
                    <td className="app-figure">{demand.donorsNotified}</td>
                    <td className="app-figure">
                      {demand.confirmedUnits} / {demand.units}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <Link className="ux4g-btn ux4g-btn-text-neutral ux4g-btn-md" href="/centre/settings">
        Centre settings
      </Link>
    </CentreShell>
  );
}
