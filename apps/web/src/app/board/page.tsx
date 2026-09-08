import type { Metadata } from 'next';

import { AppShell } from '../shell';
import { currentActor } from '@/lib/session';

export const metadata: Metadata = { title: 'Demand board · Blood Connect' };

/**
 * The public demand board (§9.4).
 *
 * No account, and the one page an outsider can read. When it carries data in
 * phase 9 it will show group, hospital, town, units outstanding and needed-by —
 * and nothing else — served from a query that **cannot** join to patients or
 * requests, with its response shape pinned by a test that fails if any new
 * column appears (§14).
 *
 * Until then it says so, rather than showing a plausible-looking sample. An
 * outsider must never be shown invented demand for a real hospital.
 */
export default async function BoardPage() {
  const actor = await currentActor();

  return (
    <AppShell actor={actor} title="Demand board">
      <div className="app-stack-tight">
        <h1 className="ux4g-heading-l-strong">Where blood is needed</h1>
        <p className="ux4g-body-m-default">
          Open donor demand, by blood group and town.
        </p>
      </div>

      <div className="ux4g-alert ux4g-alert-info" role="status">
        <div className="ux4g-alert-content">
          <p className="ux4g-alert-message">
            No demand is published yet. This board carries live figures from phase 9.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
