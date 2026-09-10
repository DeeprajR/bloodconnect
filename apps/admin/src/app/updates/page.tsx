import type { Metadata } from 'next';

import { AppShell } from '../shell';
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
  return { label: `Waiting ${days} days`, urgent: days >= 7 };
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
    <AppShell actor={actor} title="Update requests">
      <div className="app-stack-tight">
        <h1 className="ux4g-heading-l-strong">Update requests</h1>
        <p className="ux4g-body-m-default">
          A doctor cannot change their own name or registration number, because both
          appear on every request they raise. Approving one applies it for them.
        </p>
      </div>

      {problem ? (
        <div className="ux4g-alert ux4g-alert-error" role="alert">
          <div className="ux4g-alert-content">
            <p className="ux4g-alert-message">{problem}</p>
          </div>
        </div>
      ) : null}

      {queue.length === 0 ? (
        <div className="ux4g-alert ux4g-alert-info" role="status">
          <div className="ux4g-alert-content">
            <p className="ux4g-alert-message">Nothing is waiting.</p>
          </div>
        </div>
      ) : (
        <ul className="app-stack app-plain-list">
          {queue.map((row) => {
            const age = ageing(row.ageDays);
            const isOwn = actor.kind === 'user' && actor.userId === row.userId;

            return (
              <li key={row.id}>
                <section className="ux4g-card ux4g-card-outline">
                  <div className="ux4g-card-header">
                    <div className="app-row-split">
                      <h2 className="ux4g-card-title">
                        {row.requesterName} · {UPDATE_REQUEST_LABELS[row.field]}
                      </h2>
                      <span
                        className={
                          age.urgent
                            ? 'ux4g-badge-digit-danger app-figure'
                            : 'ux4g-label-m-strong app-figure'
                        }
                      >
                        {age.label}
                      </span>
                    </div>
                    <p className="ux4g-card-sub-title">
                      {row.requesterEmail} · raised {dayFormat.format(row.createdAt)}
                    </p>
                  </div>

                  <div className="ux4g-card-body app-stack-tight">
                    <dl className="app-stack-tight">
                      <div className="app-row">
                        <dt className="ux4g-label-m-strong">Currently</dt>
                        <dd className="ux4g-body-s-default">
                          {row.currentValue ?? 'Not recorded'}
                        </dd>
                      </div>
                      <div className="app-row">
                        <dt className="ux4g-label-m-strong">Proposed</dt>
                        <dd className="ux4g-body-s-strong">{row.proposedValue}</dd>
                      </div>
                      <div className="app-row">
                        <dt className="ux4g-label-m-strong">Reason given</dt>
                        <dd className="ux4g-body-s-default">{row.reason}</dd>
                      </div>
                    </dl>
                  </div>

                  <div className="ux4g-card-footer app-stack-tight">
                    {isOwn ? (
                      /*
                        §3: nobody decides their own. Hidden here as well as
                        refused in the use case. An administrator offered a
                        button that always fails has been told nothing about
                        why, and the rule is worth stating rather than
                        discovering.
                      */
                      <div className="ux4g-alert ux4g-alert-warning" role="status">
                        <div className="ux4g-alert-content">
                          <p className="ux4g-alert-message">
                            This is your own request. Another administrator has to
                            decide it.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <>
                        <form action={approveUpdateRequestAction}>
                          <input type="hidden" name="requestId" value={row.id} />
                          <button
                            type="submit"
                            className="ux4g-btn ux4g-btn-primary ux4g-btn-md app-target"
                          >
                            Approve and apply
                          </button>
                        </form>

                        <form action={rejectUpdateRequestAction} className="app-stack-tight">
                          <input type="hidden" name="requestId" value={row.id} />
                          <label
                            className="ux4g-label-m-strong"
                            htmlFor={`note-${row.id}`}
                          >
                            Or reject it, with a reason they can act on
                          </label>
                          <textarea
                            className="ux4g-input"
                            id={`note-${row.id}`}
                            name="adminNote"
                            rows={2}
                            maxLength={500}
                            required
                          />
                          <button
                            type="submit"
                            className="ux4g-btn ux4g-btn-outline-danger ux4g-btn-md app-target"
                          >
                            Reject
                          </button>
                        </form>
                      </>
                    )}
                  </div>
                </section>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
