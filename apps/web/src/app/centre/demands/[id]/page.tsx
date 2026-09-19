import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Card, DataTable, PageHeader, type Column } from '@blood-connect/ui';

import { CentreShell } from '../../../centre-shell';
import { RosterMarkForm, WalkInForm } from '../../../centre-collision-forms';
import { requireAccess, useCaseContext } from '@/lib/guards';
import { getDemand, listRoster, listWalkIns } from '@blood-connect/centre';
import { WORDING, bloodGroupLabel, productLabel } from '@blood-connect/domain';

export const metadata: Metadata = { title: 'Roster · Blood Connect' };

const OUTCOME_LABELS: Readonly<Record<string, string>> = {
  confirmed: 'Expected',
  completed: 'Donated',
  no_show: 'Did not come',
  cancelled: 'Cancelled',
  waitlisted: 'On the waiting list',
};

type RosterRow = Awaited<ReturnType<typeof listRoster>>[number];
type WalkInRow = Awaited<ReturnType<typeof listWalkIns>>[number];

/**
 * The counter's roster for one demand (§4, §8.3).
 *
 * It is a **separate page** on purpose. Donor names and phone numbers are the
 * only donor contact details that cross into the centre's half of the database
 * (§2.10), and they belong on the screen where somebody is actually calling a
 * name at a desk, not spread across a list of every demand ever raised.
 */
export default async function RosterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireAccess('/centre/demands');
  const ctx = await useCaseContext(actor);
  const { id } = await params;

  const demand = await getDemand(ctx, id);
  if (!demand) notFound();

  const [roster, walkIns] = await Promise.all([listRoster(ctx, id), listWalkIns(ctx, id)]);
  const expected = roster.filter((row) => row.status === 'confirmed');
  const settled = roster.filter((row) => row.status !== 'confirmed');

  const open = demand.status === 'open' || demand.status === 'fulfilled';

  const walkInColumns: Column<WalkInRow>[] = [
    { key: 'donor', header: 'Donor', cell: (r) => r.donorName },
    {
      key: 'group',
      header: 'Group',
      cell: (r) => <span className="tabular-nums">{bloodGroupLabel(r.bloodGroup as never)}</span>,
    },
    {
      key: 'unit',
      header: WORDING.unitNumber,
      cell: (r) => <span className="font-mono tabular-nums">{r.bagIdentifier}</span>,
    },
    { key: 'on', header: 'On', cell: (r) => <span className="tabular-nums">{r.donatedOn}</span> },
  ];

  const settledColumns: Column<RosterRow>[] = [
    { key: 'donor', header: 'Donor', cell: (r) => r.donorName },
    {
      key: 'outcome',
      header: 'Outcome',
      cell: (r) => OUTCOME_LABELS[r.status] ?? r.status,
    },
    {
      key: 'unit',
      header: WORDING.unitNumber,
      cell: (r) => (
        <span className="font-mono tabular-nums">{r.bagIdentifier ?? '—'}</span>
      ),
    },
    {
      key: 'typed',
      header: 'Typed as',
      cell: (r) => (
        <span className="tabular-nums">
          {r.donatedBloodGroup === null
            ? '—'
            : bloodGroupLabel(r.donatedBloodGroup as never)}
          {r.donatedBloodGroup !== null && r.donatedBloodGroup !== r.bloodGroup ? (
            <span className="text-ink-subtle">
              {' '}
              (told us {bloodGroupLabel(r.bloodGroup as never)})
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'on',
      header: 'On',
      cell: (r) => <span className="tabular-nums">{r.donatedAt ?? '—'}</span>,
    },
  ];

  return (
    <CentreShell actor={actor} title="Roster" currentPath="/centre/demands">
      <PageHeader
        title={`${bloodGroupLabel(demand.bloodGroup as never)} · ${productLabel(demand.product as never)}`}
        description={`${demand.units} ${demand.units === 1 ? 'unit' : 'units'} wanted by ${demand.dateRequired}. ${demand.completedUnits} collected from the roster${walkIns.length > 0 ? `, and ${walkIns.length} from people who simply came in` : ''}.`}
      />

      <Card title="Expected at the counter">
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">
            {/*
              §4: the counter is the authority on who gave blood. Nothing else
              in the system can tell these three outcomes apart.
            */}
            Mark each person once they have been seen. A no-show frees the
            place, and the bot offers it to whoever is next on the waiting
            list.
          </p>

          {expected.length === 0 ? (
            <p className="text-sm text-ink-muted">Nobody is expected right now.</p>
          ) : (
            <div className="space-y-4">
              {expected.map((row) => (
                <Card
                  key={row.id}
                  title={row.donorName}
                  className="shadow-none"
                >
                  <div className="space-y-2">
                    <p className="text-sm text-ink-muted">
                      {row.donorPhone} · {bloodGroupLabel(row.bloodGroup as never)} ·{' '}
                      {row.channel}
                    </p>
                    {!row.acknowledged ? (
                      <p className="text-xs text-ink-subtle">
                        {/* Nothing has been sent to them yet; do not assume they know. */}
                        The bot has not thanked this donor yet.
                      </p>
                    ) : null}
                    <RosterMarkForm confirmationId={row.id} declaredGroup={row.bloodGroup} />
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </Card>

      {open ? (
        <Card title="Somebody gave who is not on this list">
          <div className="space-y-4">
            <p className="text-sm text-ink-muted">
              {/*
                §4: getting a donor's interval right matters more than tidy
                state. Refusing the record would lose both the unit and the
                donor.
              */}
              Record it anyway. The donation counts towards this demand, and
              the person is credited with having given today.
            </p>
            <WalkInForm demandId={demand.id} />
          </div>
        </Card>
      ) : null}

      {walkIns.length > 0 ? (
        <Card title="Walk-ins">
          <div className="space-y-4">
            <p className="text-sm text-ink-muted">
              {/*
                The centre's own record, not a roster row: it holds no INSERT on
                the bot's roster at all (§5.1). The bot reads these and stops
                recruiting for a unit already collected.
              */}
              Recorded here rather than on the roster, because nobody on this
              list was ever asked by the bot. Each one counts against what is
              still needed.
            </p>
            <DataTable columns={walkInColumns} rows={walkIns} getRowKey={(r) => r.id} />
          </div>
        </Card>
      ) : null}

      {settled.length > 0 ? (
        <Card title="Already marked">
          <DataTable columns={settledColumns} rows={settled} getRowKey={(r) => r.id} />
        </Card>
      ) : null}

      <div>
        <Link
          href="/centre/demands"
          className="text-sm font-medium text-ink-muted hover:text-ink hover:underline"
        >
          ← Back to demand
        </Link>
      </div>
    </CentreShell>
  );
}
