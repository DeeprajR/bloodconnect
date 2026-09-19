import type { Metadata } from 'next';
import Link from 'next/link';

import { Card, EmptyState, PageHeader, StatusBadge } from '@blood-connect/ui';

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
    <CentreShell
      actor={actor}
      title={WORDING.quarantine}
      currentPath="/centre/quarantine"
    >
      <PageHeader
        title={WORDING.quarantine}
        description="A waiting room, not a destination. Every unit here is out of issue and out of the stock floor until a named person decides one of two things."
      />

      {overdue.length > 0 ? (
        <p
          role="alert"
          className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {overdue.length} {overdue.length === 1 ? 'unit has' : 'units have'}{' '}
          been waiting longer than{' '}
          <span className="tabular-nums">{ctx.config.ageing.quarantineDays}</span>{' '}
          days. Nothing should sit here indefinitely.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState title="Nothing in quarantine." />
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <Card
              key={row.id}
              title={row.unitNumber}
              actions={
                row.overdue ? (
                  <StatusBadge tone="danger" label="Overdue" />
                ) : undefined
              }
            >
              <div className="space-y-3">
                <p className="text-sm text-ink-muted">
                  {bloodGroupLabel(row.bloodGroup as never)} ·{' '}
                  {productLabel(row.product as never)} · {WORDING.expiresOn}{' '}
                  <span className="tabular-nums">{row.expiresAt}</span>
                </p>
                <p className="text-sm text-ink">
                  {row.reason}. Waiting{' '}
                  <span className="tabular-nums">
                    {row.daysWaiting === 0
                      ? 'since today'
                      : `${String(row.daysWaiting)} days`}
                  </span>
                  .
                </p>
                <QuarantineForm quarantineId={row.id} />
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-ink-subtle">
        {/* The single automatic exit §4 grants. */}
        A unit that reaches its expiry while waiting here is discarded
        automatically, with that recorded as the reason.
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
