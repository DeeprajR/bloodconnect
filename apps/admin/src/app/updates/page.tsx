import type { Metadata } from 'next';

import { Button, Card, EmptyState, PageHeader, StatusBadge } from '@blood-connect/ui';

import { KitShell } from '../kit-shell';
import { approveUpdateRequestAction, rejectUpdateRequestAction } from '../actions';
import { requireAccess, useCaseContext } from '@/lib/guards';
import { UPDATE_REQUEST_LABELS, listPendingUpdateRequests } from '@blood-connect/platform';

export const metadata: Metadata = { title: 'Update requests · Administration' };

const dayFormat = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
});

/**
 * The age of a request, said the way a person would say it.
 *
 * This is the ⚠︎ of §8. A queue that shows only a date lets a request sit for
 * a fortnight without anybody noticing it has, because reading a date requires
 * arithmetic and nobody does the arithmetic.
 */
function ageing(days: number): { label: string; urgent: boolean } {
  if (days === 0) return { label: 'Today', urgent: false };
  if (days === 1) return { label: 'Waiting 1 day', urgent: false };
  return { label: `Waiting ${String(days)} days`, urgent: days >= 7 };
}

export default async function UpdateRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ problem?: string }>;
}) {
  const actor = await requireAccess('/updates');
  const ctx = await useCaseContext(actor);
  const queue = await listPendingUpdateRequests(ctx);
  const { problem } = await searchParams;

  return (
    <KitShell currentPath="/updates" currentTitle="Update requests">
      <PageHeader
        title="Update requests"
        description="A doctor cannot change their own name or registration number, because both appear on every request they raise. Approving one applies it for them."
      />

      {problem ? (
        <p
          role="alert"
          className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {problem}
        </p>
      ) : null}

      {queue.length === 0 ? (
        <EmptyState title="Nothing is waiting." />
      ) : (
        <div className="space-y-4">
          {queue.map((row) => {
            const age = ageing(row.ageDays);
            const isOwn = actor.kind === 'user' && actor.userId === row.userId;

            return (
              <Card
                key={row.id}
                title={`${row.requesterName} · ${UPDATE_REQUEST_LABELS[row.field]}`}
                actions={
                  <StatusBadge
                    label={age.label}
                    tone={age.urgent ? 'danger' : 'neutral'}
                  />
                }
              >
                <div className="space-y-4">
                  <p className="text-sm text-ink-muted">
                    {row.requesterEmail} · raised {dayFormat.format(row.createdAt)}
                  </p>

                  <dl className="space-y-2">
                    <div className="flex items-baseline gap-2">
                      <dt className="w-24 shrink-0 text-xs font-medium uppercase tracking-wide text-ink-subtle">
                        Currently
                      </dt>
                      <dd className="text-sm text-ink-muted">
                        {row.currentValue ?? 'Not recorded'}
                      </dd>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <dt className="w-24 shrink-0 text-xs font-medium uppercase tracking-wide text-ink-subtle">
                        Proposed
                      </dt>
                      <dd className="text-sm font-medium text-ink">{row.proposedValue}</dd>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <dt className="w-24 shrink-0 text-xs font-medium uppercase tracking-wide text-ink-subtle">
                        Reason given
                      </dt>
                      <dd className="text-sm text-ink-muted">{row.reason}</dd>
                    </div>
                  </dl>

                  {isOwn ? (
                    /*
                      §3: nobody decides their own. Hidden here as well as
                      refused in the use case. An administrator offered a
                      button that always fails has been told nothing about
                      why, and the rule is worth stating rather than
                      discovering.
                    */
                    <p
                      role="status"
                      className="rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-ink"
                    >
                      This is your own request. Another administrator has to
                      decide it.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-end sm:justify-between">
                      <form action={approveUpdateRequestAction}>
                        <input type="hidden" name="requestId" value={row.id} />
                        <Button type="submit">Approve and apply</Button>
                      </form>

                      <form action={rejectUpdateRequestAction} className="flex-1 space-y-1.5 sm:max-w-sm">
                        <label
                          className="block text-sm font-medium text-ink"
                          htmlFor={`note-${row.id}`}
                        >
                          Or reject it, with a reason they can act on
                        </label>
                        <div className="flex gap-2">
                          <textarea
                            className="w-full rounded-control border border-border-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                            id={`note-${row.id}`}
                            name="adminNote"
                            rows={2}
                            maxLength={500}
                            required
                          />
                          <Button type="submit" variant="danger">
                            Reject
                          </Button>
                        </div>
                      </form>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </KitShell>
  );
}
