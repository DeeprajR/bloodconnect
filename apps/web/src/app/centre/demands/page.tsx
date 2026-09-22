import type { Metadata } from 'next';
import Link from 'next/link';

import { Card, DataTable, PageHeader, linkButtonClasses, type Column } from '@blood-connect/ui';

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

const LINK_OUTLINE = linkButtonClasses({ variant: 'secondary', size: 'sm' });

type Demand = Awaited<ReturnType<typeof listDemands>>[number];

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

  const openColumns: Column<Demand>[] = [
    {
      key: 'group',
      header: 'Group',
      cell: (d) => (
        <span className="tabular-nums">{bloodGroupLabel(d.bloodGroup as never)}</span>
      ),
    },
    { key: 'product', header: WORDING.product, cell: (d) => productLabel(d.product as never) },
    { key: 'units', header: 'Units', cell: (d) => <span className="tabular-nums">{d.units}</span> },
    {
      key: 'raised',
      header: 'Raised by',
      cell: (d) => (d.trigger === 'stock_floor' ? WORDING.stockFloor : 'Request shortfall'),
    },
    {
      key: 'needed',
      header: WORDING.neededBy,
      cell: (d) => <span className="tabular-nums">{d.dateRequired}</span>,
    },
    {
      key: 'notified',
      header: 'Notified',
      cell: (d) =>
        d.botPublicId === null ? (
          <span className="text-ink-subtle">not picked up</span>
        ) : (
          <span className="tabular-nums">{d.donorsNotified}</span>
        ),
    },
    {
      key: 'confirmed',
      header: 'Confirmed',
      cell: (d) => (
        <span className="tabular-nums">
          {d.confirmedUnits} / {d.units}
          {d.waitlistedUnits > 0 ? (
            <span className="text-ink-subtle"> (+{d.waitlistedUnits} waiting)</span>
          ) : null}
        </span>
      ),
    },
    { key: 'status', header: 'Status', cell: (d) => STATUS_LABELS[d.status] ?? d.status },
    {
      key: 'counter',
      header: 'Counter',
      cell: (d) => (
        <Link href={`/centre/demands/${d.id}`} className={LINK_OUTLINE}>
          Roster
          {(unmarked.get(d.id) ?? 0) > 0 ? (
            <span className="tabular-nums"> ({unmarked.get(d.id)})</span>
          ) : null}
        </Link>
      ),
    },
    {
      key: 'action',
      header: '',
      mobileLabel: 'Action',
      cell: (d) => <CancelDemandForm demandId={d.id} />,
    },
  ];

  const closedColumns: Column<Demand>[] = [
    {
      key: 'group',
      header: 'Group',
      cell: (d) => (
        <span className="tabular-nums">{bloodGroupLabel(d.bloodGroup as never)}</span>
      ),
    },
    { key: 'units', header: 'Units', cell: (d) => <span className="tabular-nums">{d.units}</span> },
    {
      key: 'completed',
      header: 'Completed',
      cell: (d) => <span className="tabular-nums">{d.completedUnits}</span>,
    },
    { key: 'status', header: 'Status', cell: (d) => STATUS_LABELS[d.status] ?? d.status },
    {
      key: 'raised-on',
      header: 'Raised',
      cell: (d) => <span className="tabular-nums">{day.format(d.createdAt)}</span>,
    },
  ];

  return (
    <CentreShell actor={actor} title="Demand" currentPath="/centre/demands">
      {/* The counters here are written back by the bot, so they move on their own. */}
      <LiveRefresh everySeconds={30} />

      <PageHeader
        title={WORDING.donorDemand}
        description="Progress is written back by the donor bot as people are contacted and confirm. A demand with no public identifier has not been picked up yet, and nobody has been contacted for it."
      />

      {silent.length > 0 ? (
        <p
          role="status"
          className="rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-ink"
        >
          <span className="font-medium">
            {silent.length}{' '}
            {silent.length === 1 ? 'demand has' : 'demands have'} been picked up
            by the donor bot with nobody contacted yet.
          </span>{' '}
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
      ) : null}

      <Card title="Recruiting now">
        <DataTable
          columns={openColumns}
          rows={open}
          getRowKey={(d) => d.id}
          emptyLabel="No recruitment in progress."
        />
      </Card>

      {closed.length > 0 ? (
        <Card title="Closed">
          <DataTable columns={closedColumns} rows={closed} getRowKey={(d) => d.id} />
        </Card>
      ) : null}

      <p className="text-xs text-ink-subtle">
        {/*
          Donor names live one click away, not on this list (§2.10). The counter
          needs them; a page showing every demand ever raised does not.
        */}
        Donor names and numbers are on each roster, where somebody is calling a
        name at a desk, not on this list.
      </p>

      <div>
        <Link
          href="/centre"
          className="text-sm font-medium text-ink-muted hover:text-ink hover:underline"
        >
          ← Back to the overview
        </Link>
      </div>
    </CentreShell>
  );
}
