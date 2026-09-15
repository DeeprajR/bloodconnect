import type { Metadata } from 'next';
import Link from 'next/link';

import { Card, PageHeader, StatusBadge } from '@blood-connect/ui';

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

/**
 * Small link-styled-as-button classes for the header CTA and the
 * secondary links in the "register" card. Adding a LinkButton primitive
 * for a handful of callers is more layers than the callers; the kit's
 * tokens (`bg-primary`, `border-border-strong`, `rounded-control`) are
 * available here directly.
 */
const LINK_PRIMARY =
  'inline-flex h-10 items-center justify-center gap-2 rounded-control ' +
  'border border-transparent bg-primary px-4 text-sm font-medium text-white ' +
  'transition-colors hover:bg-primary-hover focus-visible:outline ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2';
const LINK_SECONDARY =
  'inline-flex h-10 items-center justify-center gap-2 rounded-control ' +
  'border border-border-strong bg-surface px-4 text-sm font-medium text-ink ' +
  'transition-colors hover:bg-surface-muted focus-visible:outline ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2';
const LINK_GHOST =
  'text-sm font-medium text-primary hover:underline';

export default async function CentrePage() {
  const actor = await requireAccess('/centre');
  if (actor.kind !== 'user') return null;

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
   * `stockByGroup` returns storage order. Ordering only the chart would
   * leave the table under it disagreeing with the bars directly above,
   * which is worse than either order on its own.
   */
  const byGroup = new Map(stock.map((row) => [row.bloodGroup, row]));
  const shelf = STOCK_DISPLAY_ORDER.map((group) => byGroup.get(group)).filter(
    (row) => row !== undefined,
  );
  const overdue = queue.filter((row) => row.dateRequired < today);

  return (
    <CentreShell actor={actor} title="Blood centre" currentPath="/centre">
      <PageHeader
        title="Overview"
        description="Answer requests from stock. Whatever the shelf cannot cover becomes demand for real donors, in the same transaction."
        actions={
          <Link href="/centre/requests" className={LINK_PRIMARY}>
            {queue.length === 0
              ? 'Request queue'
              : `Answer ${String(queue.length)} waiting`}
          </Link>
        }
      />

      {discrepancies.length > 0 ? (
        <p
          role="alert"
          className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-ink"
        >
          {/*
            §4: a discrepancy never clears itself, so it is the one alarm
            on this page that stays until a person has physically looked.
          */}
          <span className="font-medium text-danger">
            {discrepancies.length} open tag{' '}
            {discrepancies.length === 1 ? 'discrepancy' : 'discrepancies'}.
          </span>{' '}
          Until each is closed, two units may carry the same tag.{' '}
          <Link href="/centre/tags" className="font-medium underline">
            Open them
          </Link>
          .
        </p>
      ) : null}

      {overdue.length > 0 ? (
        <p
          role="alert"
          className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-ink"
        >
          <span className="font-medium text-danger">
            {overdue.length}{' '}
            {overdue.length === 1 ? 'request is' : 'requests are'} past the
            day the blood was needed.
          </span>{' '}
          <Link href="/centre/requests" className="font-medium underline">
            Open the queue
          </Link>
          .
        </p>
      ) : null}

      <Card
        title={`${WORDING.stockOnHand} against the ${WORDING.stockFloor.toLowerCase()}`}
      >
        <p className="mb-4 text-xs text-ink-subtle">
          {/*
            Red cells only, and the reason is worth stating on the
            screen: a floor met by plasma would read as comfortable while
            there was nothing a walk-in donor could replace.
          */}
          Whole blood and packed red cells. The components a donor can
          actually replace. Reserved units are excluded; they belong to a
          decision already made.
        </p>

        <div className="space-y-4">
          {/*
            The picture first, then the numbers behind it. StockChart is
            still UX4G-styled — its host card is kit, its bars aren't
            yet. Ports in a follow-up.
          */}
          <StockChart
            rows={shelf}
            fractions={{
              low: ctx.config.stock.lowFraction,
              critical: ctx.config.stock.criticalFraction,
            }}
          />

          <div className="overflow-x-auto rounded-card border border-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-ink-subtle">
                  <th scope="col" className="px-4 py-2 text-left font-semibold">
                    Group
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">
                    On the shelf
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">
                    Reserved
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">
                    Floor
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">
                    Short by
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">
                    Expiring within 7 days
                  </th>
                </tr>
              </thead>
              <tbody>
                {shelf.map((row) => (
                  <tr
                    key={row.bloodGroup}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-2.5 align-middle font-medium tabular-nums text-ink">
                      {bloodGroupLabel(row.bloodGroup)}
                    </td>
                    <td className="px-4 py-2.5 text-right align-middle tabular-nums text-ink">
                      {row.onShelf}
                    </td>
                    <td className="px-4 py-2.5 text-right align-middle tabular-nums text-ink">
                      {row.reserved}
                    </td>
                    <td className="px-4 py-2.5 text-right align-middle tabular-nums text-ink">
                      {row.floor}
                    </td>
                    <td className="px-4 py-2.5 text-right align-middle">
                      {row.short > 0 ? (
                        <StatusBadge
                          label={String(row.short)}
                          tone="danger"
                        />
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right align-middle tabular-nums text-ink">
                      {row.expiringSoon > 0 ? row.expiringSoon : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <form action={recruitForFloorAction}>
              <RecruitButton shortGroups={short.length} />
            </form>
            <p className="text-xs text-ink-subtle">
              {/* The partial unique index makes this safe to press twice (§5.6). */}
              One demand per short group. A group that already has an open
              floor demand is skipped, so pressing this twice recruits
              nobody twice.
            </p>
          </div>
        </div>
      </Card>

      {/*
        Second section, and the other half of the day's work: the shelf
        above, the people who fill it here.
      */}
      <Card
        title="Donations"
        actions={
          <Link href="/centre/donations" className={LINK_GHOST}>
            All donations →
          </Link>
        }
      >
        <p className="mb-4 text-xs text-ink-subtle">
          Donors expected at the counter, and what has already been
          collected.
        </p>
        <div className="space-y-6">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-ink">Coming in</h3>
            <UpcomingDonations rows={upcoming} />
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-ink">Already given</h3>
            <CompletedDonations rows={completed} />
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Recruitment in progress">
          <div className="space-y-3">
            <p className="text-sm text-ink">
              <span className="text-lg font-semibold tabular-nums">
                {counts.openDemands}
              </span>{' '}
              open{' '}
              {counts.openDemands === 1 ? 'demand' : 'demands'}.
            </p>
            {counts.awaitingImport > 0 ? (
              <p className="text-xs text-ink-muted">
                {/*
                  The bot polls for these. Until it runs, "raised" and
                  "donors contacted" are different things, and the screen
                  says so.
                */}
                <span className="tabular-nums">{counts.awaitingImport}</span>{' '}
                not yet picked up by the donor bot. Nobody has been
                contacted for those.
              </p>
            ) : null}
            <Link href="/centre/demands" className={LINK_GHOST}>
              Open demands →
            </Link>
          </div>
        </Card>

        <Card title="The register">
          <div className="space-y-3">
            <p className="text-sm text-ink">
              <span className="text-lg font-semibold tabular-nums">
                {counts.reservedBags}
              </span>{' '}
              units reserved against a decision.
            </p>
            {quarantined.length > 0 ? (
              <p className="text-xs text-ink-muted">
                {/*
                  Quarantine is a waiting room, and a waiting room nobody
                  can see is where units are forgotten (§4).
                */}
                <span className="tabular-nums">{quarantined.length}</span>{' '}
                in {WORDING.quarantine.toLowerCase()}, waiting for a
                decision
                {quarantined.some((row) => row.overdue) ? ', some overdue' : ''}
                .
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Link href="/centre/stock/new" className={LINK_SECONDARY}>
                Register a bag
              </Link>
              <Link href="/centre/tags" className={LINK_SECONDARY}>
                Scan a tag
              </Link>
              <Link href="/centre/stock" className={LINK_GHOST}>
                View stock →
              </Link>
              <Link href="/centre/quarantine" className={LINK_GHOST}>
                {WORDING.quarantine} →
              </Link>
            </div>
          </div>
        </Card>
      </div>

      {demands.length > 0 ? (
        <Card title={`Open ${WORDING.donorDemand.toLowerCase()}`}>
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-ink-subtle">
                  <th scope="col" className="px-4 py-2 text-left font-semibold">
                    Group
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">
                    Units
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-semibold">
                    Raised by
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">
                    Notified
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">
                    Confirmed
                  </th>
                </tr>
              </thead>
              <tbody>
                {demands.slice(0, 8).map((demand) => (
                  <tr
                    key={demand.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-2.5 align-middle font-medium tabular-nums text-ink">
                      {demand.bloodGroup}
                    </td>
                    <td className="px-4 py-2.5 text-right align-middle tabular-nums text-ink">
                      {demand.units}
                    </td>
                    <td className="px-4 py-2.5 align-middle text-ink">
                      {demand.trigger === 'stock_floor'
                        ? 'Stock floor'
                        : 'Request shortfall'}
                    </td>
                    <td className="px-4 py-2.5 text-right align-middle tabular-nums text-ink">
                      {demand.donorsNotified}
                    </td>
                    <td className="px-4 py-2.5 text-right align-middle tabular-nums text-ink">
                      {demand.confirmedUnits} / {demand.units}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <div>
        <Link
          href="/centre/settings"
          className="text-sm font-medium text-ink-muted hover:text-ink hover:underline"
        >
          Centre settings →
        </Link>
      </div>
    </CentreShell>
  );
}
