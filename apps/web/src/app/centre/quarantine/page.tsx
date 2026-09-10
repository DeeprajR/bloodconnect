import type { Metadata } from 'next';
import Link from 'next/link';

import { CentreShell } from '../../centre-shell';
import { QuarantineForm } from '../../centre-collision-forms';
import { requireAccess, useCaseContext } from '@/lib/guards';
import { listQuarantine } from '@blood-connect/centre';
import { WORDING, bloodGroupLabel, productLabel } from '@blood-connect/domain';

export const metadata: Metadata = { title: 'Quarantine · Blood Connect' };

/**
 * The waiting room, with how long each unit has been in it (§4).
 *
 * "Quarantined units age visibly; one unresolved past a threshold is escalated,
 * and a quarantined bag that reaches its expiry is discarded automatically."
 * The age is the whole point of the screen. A list without it would let a unit
 * sit here for a month without anybody noticing.
 */
export default async function QuarantinePage() {
  const actor = await requireAccess('/centre/quarantine');
  const ctx = await useCaseContext(actor);

  const rows = await listQuarantine(ctx);
  const overdue = rows.filter((row) => row.overdue);

  return (
    <CentreShell actor={actor} title={WORDING.quarantine}>
      <div className="app-stack-tight">
        <h1 className="ux4g-heading-l-strong">{WORDING.quarantine}</h1>
        <p className="ux4g-body-m-default">
          A waiting room, not a destination. Every unit here is out of issue and out of
          the stock floor until a named person decides one of two things.
        </p>
      </div>

      {overdue.length > 0 ? (
        <div className="ux4g-alert ux4g-alert-error" role="alert">
          <div className="ux4g-alert-content">
            <p className="ux4g-alert-message">
              {overdue.length} {overdue.length === 1 ? 'unit has' : 'units have'} been
              waiting longer than {ctx.config.ageing.quarantineDays} days. Nothing should
              sit here indefinitely.
            </p>
          </div>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <section className="ux4g-card ux4g-card-outline">
          <div className="ux4g-card-body">
            <p className="ux4g-body-s-default">Nothing in quarantine.</p>
          </div>
        </section>
      ) : (
        <div className="app-stack">
          {rows.map((row) => (
            <section key={row.id} className="ux4g-card ux4g-card-outline">
              <div className="ux4g-card-header">
                <h2 className="ux4g-card-title app-figure">{row.unitNumber}</h2>
                <p className="ux4g-card-sub-title app-figure">
                  {bloodGroupLabel(row.bloodGroup as never)} ·{' '}
                  {productLabel(row.product as never)} · {WORDING.expiresOn} {row.expiresAt}
                </p>
              </div>
              <div className="ux4g-card-body app-stack">
                <p className="ux4g-body-m-default">
                  {row.reason}. Waiting{' '}
                  <span className="app-figure">
                    {row.daysWaiting === 0 ? 'since today' : `${String(row.daysWaiting)} days`}
                  </span>
                  {row.overdue ? (
                    <span className="ux4g-badge-digit-danger"> Overdue</span>
                  ) : null}
                  .
                </p>
                <QuarantineForm quarantineId={row.id} />
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="ux4g-label-m-default">
        {/* The single automatic exit §4 grants. */}
        A unit that reaches its expiry while waiting here is discarded automatically, with
        that recorded as the reason.
      </p>

      <Link className="ux4g-btn ux4g-btn-text-neutral ux4g-btn-md" href="/centre">
        Back to the overview
      </Link>
    </CentreShell>
  );
}
