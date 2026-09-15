import type { Metadata } from 'next';
import Link from 'next/link';

import { LiveRefresh } from '../volunteer/live';
import { currentActor } from '@/lib/session';
import { useCaseContext } from '@/lib/guards';
import { STOCK_DISPLAY_ORDER } from '@blood-connect/domain';
import { publicBoard } from '@blood-connect/volunteer';
import { landingFor } from '@blood-connect/platform';

export const metadata: Metadata = { title: 'Demand board · Blood Connect' };

export const dynamic = 'force-dynamic';

const dayFormat = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Asia/Kolkata',
});

const asDay = (value: string): string =>
  dayFormat.format(new Date(`${value}T00:00:00+05:30`));

/**
 * The public demand board (§6, §9.4).
 *
 * No account, and the one page an outsider can read. It shows five fields
 * and has no way to show a sixth: `publicBoard` returns a fixed shape,
 * pinned by a test that fails if a field is added, so a column cannot
 * arrive here by being convenient somewhere else (§14).
 *
 * No sharing tools and no district scoping, which is what separates it
 * from the volunteer dashboard: this is one page anybody can open or
 * forward, and a scoped version of it would be a page that quietly hid
 * demand from the person reading it.
 *
 * No app shell: this is one of the two anonymous surfaces. A minimal top
 * bar carries just the brand and the door to the rest of the system,
 * because the page must remain openable and forwardable by a stranger.
 */
export default async function BoardPage() {
  const actor = await currentActor();
  const ctx = await useCaseContext(actor);

  /*
   * Behind a flag, because §11.2 says so for this page by name and because
   * the decision to publish a hospital's demand to the open web is the
   * centre's to make, not a deployment's. Off, the page says it is not
   * published rather than showing a plausible-looking sample: an outsider
   * must never be shown invented demand for a real hospital.
   */
  const published = ctx.config.flag.publicBoard;
  const rows = published ? await publicBoard(ctx) : [];

  const byGroup = STOCK_DISPLAY_ORDER.map((group) => ({
    group,
    units: rows
      .filter((row) => row.bloodGroup === group)
      .reduce((sum, row) => sum + row.unitsOutstanding, 0),
  })).filter((entry) => entry.units > 0);

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-surface px-4">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold text-ink hover:underline"
        >
          <span
            aria-hidden
            className="flex size-7 items-center justify-center rounded-control bg-primary text-xs font-bold text-white"
          >
            B
          </span>
          Blood Connect
        </Link>
        <span className="text-sm text-ink-muted">· Demand board</span>
        <div className="ml-auto">
          {actor.kind === 'user' ? (
            <Link
              href={landingFor(actor.role)}
              className="text-sm font-medium text-primary hover:underline"
            >
              Continue →
            </Link>
          ) : (
            <Link
              href="/sign-in"
              className="text-sm font-medium text-primary hover:underline"
            >
              Sign in →
            </Link>
          )}
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 space-y-6 p-4 sm:p-6">
        <LiveRefresh everySeconds={120} />

        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            Where blood is needed
          </h1>
          <p className="text-sm text-ink-muted">
            Open donor demand, by blood group and town. Counts and hospitals
            only. No patient and no donor appears on this page.
          </p>
        </div>

        {!published ? (
          <p
            role="status"
            className="rounded-control border border-info/30 bg-info-soft px-3 py-2 text-sm text-ink"
          >
            This board is not published yet. Ask the blood centre what is
            needed.
          </p>
        ) : rows.length === 0 ? (
          <p
            role="status"
            className="rounded-control border border-success/30 bg-success-soft px-3 py-2 text-sm text-ink"
          >
            Nothing is outstanding right now. Thank you to everyone who came
            in.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {byGroup.map((entry) => (
                <span
                  key={entry.group}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-sm font-medium tabular-nums text-ink"
                >
                  <span className="font-semibold">{entry.group}</span>
                  <span className="text-ink-muted">{entry.units}</span>
                </span>
              ))}
            </div>

            <div className="overflow-x-auto rounded-card border border-border bg-surface">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">
                  Open donor demand, soonest first
                </caption>
                <thead>
                  <tr className="border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-ink-subtle">
                    <th scope="col" className="px-4 py-2 text-left font-semibold">
                      Group
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-semibold">
                      Hospital
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-semibold">
                      Town
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-semibold">
                      Units needed
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-semibold">
                      Needed by
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={`${row.bloodGroup}-${row.hospitalName}-${row.neededBy}`}
                      className="border-b border-border last:border-0"
                    >
                      <th
                        scope="row"
                        className="px-4 py-2.5 text-left align-middle font-semibold tabular-nums text-ink"
                      >
                        {row.bloodGroup}
                      </th>
                      <td className="px-4 py-2.5 align-middle text-ink">
                        {row.hospitalName}
                      </td>
                      <td className="px-4 py-2.5 align-middle text-ink">
                        {row.town ?? 'Not given'}
                      </td>
                      <td className="px-4 py-2.5 text-right align-middle tabular-nums text-ink">
                        {row.unitsOutstanding}
                      </td>
                      <td className="px-4 py-2.5 text-right align-middle tabular-nums text-ink">
                        {asDay(row.neededBy)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <p
          role="note"
          className="rounded-control border border-info/30 bg-info-soft px-3 py-2 text-sm text-ink"
        >
          If you would like to donate, go to the hospital blood centre.
          Eligibility is assessed there, before any donation, by the centre
          staff.
        </p>
      </main>
    </div>
  );
}
