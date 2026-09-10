import type { Metadata } from 'next';

import { AppShell } from '../shell';
import { LiveRefresh } from '../volunteer/live';
import { currentActor } from '@/lib/session';
import { useCaseContext } from '@/lib/guards';
import { STOCK_DISPLAY_ORDER } from '@blood-connect/domain';
import { publicBoard } from '@blood-connect/volunteer';

export const metadata: Metadata = { title: 'Demand board · Blood Connect' };

export const dynamic = 'force-dynamic';

const dayFormat = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Asia/Kolkata',
});

const asDay = (value: string): string => dayFormat.format(new Date(`${value}T00:00:00+05:30`));

/**
 * The public demand board (§6, §9.4).
 *
 * No account, and the one page an outsider can read. It shows five fields and
 * has no way to show a sixth: `publicBoard` returns a fixed shape, pinned by a
 * test that fails if a field is added, so a column cannot arrive here by being
 * convenient somewhere else (§14).
 *
 * No sharing tools and no district scoping, which is what separates it from the
 * volunteer dashboard: this is one page anybody can open or forward, and a
 * scoped version of it would be a page that quietly hid demand from the person
 * reading it.
 */
export default async function BoardPage() {
  const actor = await currentActor();
  const ctx = await useCaseContext(actor);

  /*
   * Behind a flag, because §11.2 says so for this page by name and because the
   * decision to publish a hospital's demand to the open web is the centre's to
   * make, not a deployment's. Off, the page says it is not published rather
   * than showing a plausible-looking sample: an outsider must never be shown
   * invented demand for a real hospital.
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
    <AppShell actor={actor} title="Demand board">
      <LiveRefresh everySeconds={120} />

      <div className="app-stack-tight">
        <h1 className="ux4g-heading-l-strong">Where blood is needed</h1>
        <p className="ux4g-body-m-default">
          Open donor demand, by blood group and town. Counts and hospitals only. No
          patient and no donor appears on this page.
        </p>
      </div>

      {!published ? (
        <div className="ux4g-alert ux4g-alert-info" role="status">
          <div className="ux4g-alert-content">
            <p className="ux4g-alert-message">
              This board is not published yet. Ask the blood centre what is needed.
            </p>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className="ux4g-alert ux4g-alert-success" role="status">
          <div className="ux4g-alert-content">
            <p className="ux4g-alert-message">
              Nothing is outstanding right now. Thank you to everyone who came in.
            </p>
          </div>
        </div>
      ) : (
        <>
          <p className="ux4g-body-m-default">
            {byGroup.map((entry) => (
              <span className="app-board-chip app-figure" key={entry.group}>
                {entry.group} {entry.units}
              </span>
            ))}
          </p>

          <div className="app-scroll-x">
            <table className="ux4g-table">
              <caption className="app-sr-only">
                Open donor demand, soonest first
              </caption>
              <thead>
                <tr>
                  <th scope="col">Group</th>
                  <th scope="col">Hospital</th>
                  <th scope="col">Town</th>
                  <th scope="col">Units needed</th>
                  <th scope="col">Needed by</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.bloodGroup}-${row.hospitalName}-${row.neededBy}`}>
                    <th scope="row" className="app-figure">
                      {row.bloodGroup}
                    </th>
                    <td>{row.hospitalName}</td>
                    <td>{row.town ?? 'Not given'}</td>
                    <td className="app-figure">{row.unitsOutstanding}</td>
                    <td className="app-figure">{asDay(row.neededBy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="ux4g-alert ux4g-alert-info" role="note">
        <div className="ux4g-alert-content">
          <p className="ux4g-alert-message">
            If you would like to donate, go to the hospital blood centre. Eligibility is
            assessed there, before any donation, by the centre staff.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
