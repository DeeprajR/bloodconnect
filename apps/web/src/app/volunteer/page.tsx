import type { Metadata } from 'next';
import Link from 'next/link';

import { AppShell } from '../shell';
import { LiveRefresh } from './live';
import { PressureLegend, PressureTiles } from './pressure-tiles';
import { ShareMessage } from './share-message';
import { TrendStrip } from './trend-strip';
import { requireAccess, useCaseContext } from '@/lib/guards';
import { PRESSURE_LEVELS, shareMessageFor } from '@blood-connect/domain';
import {
  asBloodGroup,
  demandsForGroup,
  groupPressure,
  scopeFor,
  trend,
} from '@blood-connect/volunteer';

export const metadata: Metadata = { title: 'Volunteer · Blood Connect' };

/** Numbers that move on the scale of minutes are never worth caching (§6). */
export const dynamic = 'force-dynamic';

const dayFormat = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Asia/Kolkata',
});

const boardUrl = (): string =>
  `${process.env['STAFF_APP_URL']?.replace(/\/+$/, '') ?? 'http://localhost:3000'}/board`;

/** A stored `YYYY-MM-DD` read as a day in Kerala, not in the server's zone. */
const asDay = (value: string): string => dayFormat.format(new Date(`${value}T00:00:00+05:30`));

export default async function VolunteerPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>;
}) {
  const actor = await requireAccess('/volunteer');
  const ctx = await useCaseContext(actor);
  const scope = scopeFor(actor);

  const tiles = await groupPressure(ctx, scope);

  // Guarded rather than trusted: a group arrives from a URL, and an unchecked
  // one would make the tile link into a probe against the query.
  const { group: requested } = await searchParams;
  const group = asBloodGroup(requested);

  const demands = group ? await demandsForGroup(ctx, group, scope) : [];
  const history = group ? await trend(ctx, { weeks: 6, group, scope }) : [];

  const message = group
    ? shareMessageFor(
        group,
        demands
          .filter((line) => line.unitsOutstanding > 0)
          .map((line) => ({
            hospitalName: line.hospitalName,
            town: line.town,
            unitsOutstanding: line.unitsOutstanding,
            neededBy: asDay(line.neededBy),
          })),
        { boardUrl: boardUrl() },
      )
    : null;

  return (
    <AppShell actor={actor} title="Volunteer">
      <LiveRefresh />

      <div className="app-stack-tight">
        <h1 className="ux4g-heading-l-strong">Where blood is needed</h1>
        <p className="ux4g-body-m-default">
          Counts and hospitals. No patient, no doctor and no donor appears on this
          screen.
          {scope.districtId ? ' Showing your district only.' : null}
        </p>
      </div>

      <section className="app-stack-tight" aria-label="Pressure by blood group">
        <PressureTiles tiles={tiles} selected={group} />
        <PressureLegend levels={PRESSURE_LEVELS} />
      </section>

      {group === null ? (
        <div className="ux4g-alert ux4g-alert-info" role="status">
          <div className="ux4g-alert-content">
            <p className="ux4g-alert-message">
              Choose a group above to see what is open behind it, and the message to
              forward.
            </p>
          </div>
        </div>
      ) : (
        <section className="ux4g-card ux4g-card-outline">
          <div className="ux4g-card-header">
            <div className="app-row-split">
              <h2 className="ux4g-card-title">
                Open for <span className="app-figure">{group}</span>
              </h2>
              <Link className="ux4g-btn ux4g-btn-text-primary ux4g-btn-md app-target" href="/volunteer">
                Clear
              </Link>
            </div>
          </div>

          <div className="ux4g-card-body app-stack">
            {demands.length === 0 ? (
              <p className="ux4g-body-m-default">
                Nothing open for {group} right now. Thank you. Please keep the group
                ready.
              </p>
            ) : (
              <div className="app-scroll-x">
                <table className="ux4g-table">
                  <caption className="app-sr-only">
                    {`Open demand for ${group}, soonest first`}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Hospital</th>
                      <th scope="col">Town</th>
                      <th scope="col">Still needed</th>
                      <th scope="col">Confirmed</th>
                      <th scope="col">Messaged</th>
                      <th scope="col">Needed by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {demands.map((line) => (
                      <tr key={line.id}>
                        <th scope="row">
                          {line.hospitalName}
                          {line.forStockFloor ? (
                            <span className="ux4g-label-s-default"> · shelf below floor</span>
                          ) : null}
                        </th>
                        <td>{line.town ?? '-'}</td>
                        <td className="app-figure">{line.unitsOutstanding}</td>
                        <td className="app-figure">{line.unitsConfirmed}</td>
                        <td className="app-figure">{line.donorsNotified}</td>
                        <td className="app-figure">{asDay(line.neededBy)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {message ? <ShareMessage message={message} /> : null}
          </div>

          <div className="ux4g-card-footer">
            <TrendStrip points={history} group={group} />
          </div>
        </section>
      )}
    </AppShell>
  );
}
