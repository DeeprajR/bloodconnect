import Link from 'next/link';

import { DataTable, type Column } from '@blood-connect/ui';
import { bloodGroupLabel } from '@blood-connect/domain';
import type { DonationRow } from '@blood-connect/centre';

/**
 * Who is coming in, and who has already given.
 *
 * One component, two entry points: the dashboard shows the next few of each and
 * `/centre/donations` shows the full lists. A second implementation would drift,
 * and the two would disagree about what a walk-in looks like within a month.
 *
 * **No phone numbers here.** The demand's own donor list carries them, because
 * that is where
 * somebody is calling a name at a desk; a list to be read does not need them,
 * and §2.10 asks for the narrower read wherever one will do.
 */

const CHANNEL_LABELS: Readonly<Record<string, string>> = {
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  memory: 'Test channel',
  walk_in: 'Walked in',
};

const channelLabel = (channel: string): string => CHANNEL_LABELS[channel] ?? channel;

export function UpcomingDonations({
  rows,
  empty = 'Nobody is expected at the counter.',
}: {
  readonly rows: readonly DonationRow[];
  readonly empty?: string;
}) {
  const columns: Column<DonationRow>[] = [
    { key: 'donor', header: 'Donor', cell: (r) => r.donorName },
    {
      key: 'group',
      header: 'Group',
      cell: (r) => (
        <span className="tabular-nums">{bloodGroupLabel(r.bloodGroup as never)}</span>
      ),
    },
    {
      key: 'expected',
      header: 'Expected by',
      cell: (r) => <span className="tabular-nums">{r.day}</span>,
    },
    { key: 'reached', header: 'Reached on', cell: (r) => channelLabel(r.channel) },
    {
      key: 'roster',
      header: '',
      mobileLabel: 'Roster',
      align: 'right',
      cell: (r) => (
        // Marking somebody off happens on the roster, with the phone
        // number next to the name.
        <Link
          href={`/centre/demands/${r.demandId}`}
          className="font-medium text-primary hover:underline"
        >
          Open roster
        </Link>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={[...rows]}
      getRowKey={(r) => r.id}
      emptyLabel={empty}
    />
  );
}

export function CompletedDonations({
  rows,
  empty = 'No donations recorded yet.',
}: {
  readonly rows: readonly DonationRow[];
  readonly empty?: string;
}) {
  const columns: Column<DonationRow>[] = [
    { key: 'donor', header: 'Donor', cell: (r) => r.donorName },
    {
      key: 'group',
      header: 'Group',
      cell: (r) => (
        <span className="tabular-nums">{bloodGroupLabel(r.bloodGroup as never)}</span>
      ),
    },
    {
      key: 'unit',
      header: 'Unit',
      cell: (r) => (
        <span className="font-mono tabular-nums">{r.bagIdentifier ?? '—'}</span>
      ),
    },
    {
      key: 'given',
      header: 'Given on',
      cell: (r) => <span className="tabular-nums">{r.day}</span>,
    },
    { key: 'how', header: 'How', cell: (r) => channelLabel(r.channel) },
  ];

  return (
    <DataTable
      columns={columns}
      rows={[...rows]}
      getRowKey={(r) => r.id}
      emptyLabel={empty}
    />
  );
}
