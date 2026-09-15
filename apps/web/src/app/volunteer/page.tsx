import type { Metadata } from 'next';
import Link from 'next/link';

import { Card, PageHeader } from '@blood-connect/ui';

import { KitShell } from '../kit-shell';
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
const asDay = (value: string): string =>
  dayFormat.format(new Date(`${value}T00:00:00+05:30`));

export default async function VolunteerPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>;
}) {
  const actor = await requireAccess('/volunteer');
  if (actor.kind !== 'user') return null;

  const ctx = await useCaseContext(actor);
  const scope = scopeFor(actor);

  const tiles = await groupPressure(ctx, scope);

  // Guarded rather than trusted: a group arrives from a URL, and an
  // unchecked one would make the tile link into a probe against the query.
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
    <KitShell role={actor.role} currentPath="/volunteer" currentTitle="Volunteer">
      <LiveRefresh />

      <PageHeader
        title="Where blood is needed"
        description={`Counts and hospitals. No patient, no doctor and no donor appears on this screen.${
          scope.districtId ? ' Showing your district only.' : ''
        }`}
      />

      <section aria-label="Pressure by blood group" className="space-y-3">
        <PressureTiles tiles={tiles} selected={group} />
        <PressureLegend levels={PRESSURE_LEVELS} />
      </section>

      {group === null ? (
        <p
          role="status"
          className="rounded-control border border-info/30 bg-info-soft px-3 py-2 text-sm text-ink"
        >
          Choose a group above to see what is open behind it, and the message
          to forward.
        </p>
      ) : (
        <Card
          title={`Open for ${group}`}
          actions={
            <Link
              href="/volunteer"
              className="text-sm font-medium text-primary hover:underline"
            >
              Clear
            </Link>
          }
        >
          <div className="space-y-4">
            {demands.length === 0 ? (
              <p className="text-sm text-ink-muted">
                Nothing open for {group} right now. Thank you. Please keep
                the group ready.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-card border border-border">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">
                    {`Open demand for ${group}, soonest first`}
                  </caption>
                  <thead>
                    <tr className="border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-ink-subtle">
                      <th scope="col" className="px-4 py-2 text-left font-semibold">
                        Hospital
                      </th>
                      <th scope="col" className="px-4 py-2 text-left font-semibold">
                        Town
                      </th>
                      <th scope="col" className="px-4 py-2 text-right font-semibold">
                        Still needed
                      </th>
                      <th scope="col" className="px-4 py-2 text-right font-semibold">
                        Confirmed
                      </th>
                      <th scope="col" className="px-4 py-2 text-right font-semibold">
                        Messaged
                      </th>
                      <th scope="col" className="px-4 py-2 text-right font-semibold">
                        Needed by
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {demands.map((line) => (
                      <tr
                        key={line.id}
                        className="border-b border-border last:border-0"
                      >
                        <th
                          scope="row"
                          className="px-4 py-2.5 text-left align-middle font-medium text-ink"
                        >
                          {line.hospitalName}
                          {line.forStockFloor ? (
                            <span className="ml-1 text-xs font-normal text-ink-subtle">
                              · shelf below floor
                            </span>
                          ) : null}
                        </th>
                        <td className="px-4 py-2.5 align-middle text-ink">
                          {line.town ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right align-middle tabular-nums text-ink">
                          {line.unitsOutstanding}
                        </td>
                        <td className="px-4 py-2.5 text-right align-middle tabular-nums text-ink">
                          {line.unitsConfirmed}
                        </td>
                        <td className="px-4 py-2.5 text-right align-middle tabular-nums text-ink">
                          {line.donorsNotified}
                        </td>
                        <td className="px-4 py-2.5 text-right align-middle tabular-nums text-ink">
                          {asDay(line.neededBy)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {message ? <ShareMessage message={message} /> : null}

            <div className="border-t border-border pt-4">
              <TrendStrip points={history} group={group} />
            </div>
          </div>
        </Card>
      )}
    </KitShell>
  );
}
