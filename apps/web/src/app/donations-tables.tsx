import Link from 'next/link';

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
  if (rows.length === 0) {
    return <p className="ux4g-body-s-default">{empty}</p>;
  }

  return (
    <div className="app-scroll-x">
      <table className="ux4g-table">
        <thead>
          <tr>
            <th scope="col">Donor</th>
            <th scope="col">Group</th>
            <th scope="col">Expected by</th>
            <th scope="col">Reached on</th>
            <th scope="col">
              <span className="app-sr-only">Donors coming in</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.donorName}</td>
              <td className="app-figure">{bloodGroupLabel(row.bloodGroup as never)}</td>
              <td className="app-figure">{row.day}</td>
              <td>{channelLabel(row.channel)}</td>
              <td>
                {/* Marking somebody off happens on the demand's donor list,
                    with the phone number next to the name. */}
                <Link href={`/centre/demands/${row.demandId}`}>See donors</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CompletedDonations({
  rows,
  empty = 'No donations recorded yet.',
}: {
  readonly rows: readonly DonationRow[];
  readonly empty?: string;
}) {
  if (rows.length === 0) {
    return <p className="ux4g-body-s-default">{empty}</p>;
  }

  return (
    <div className="app-scroll-x">
      <table className="ux4g-table">
        <thead>
          <tr>
            <th scope="col">Donor</th>
            <th scope="col">Group</th>
            <th scope="col">Unit</th>
            <th scope="col">Given on</th>
            <th scope="col">How</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.donorName}</td>
              <td className="app-figure">{bloodGroupLabel(row.bloodGroup as never)}</td>
              <td className="app-figure">{row.bagIdentifier ?? '-'}</td>
              <td className="app-figure">{row.day}</td>
              <td>{channelLabel(row.channel)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
