import type { Metadata } from 'next';
import Link from 'next/link';

import { CentreShell } from '../../centre-shell';
import { requireAccess, useCaseContext } from '@/lib/guards';
import { stockByGroup } from '@blood-connect/centre';
import { listRequestsAwaitingDecision } from '@blood-connect/hospital';
import {
  URGENCY_SHORT,
  WORDING,
  bloodGroupLabel,
  isPastResponseTarget,
  isUrgency,
  minutesWaiting,
  productLabel,
  waitingLabel,
  type Urgency,
} from '@blood-connect/domain';

export const metadata: Metadata = { title: 'Request queue · Blood Connect' };

/**
 * The queue (§4).
 *
 * Ordered by the day the blood is needed, so the oldest need is at the top and
 * an overdue request cannot be buried under newer ones — and every row carries
 * the stock on hand for its group, because the whole question a counter is
 * answering is "can I fill this".
 *
 * The patient details are the frozen snapshot (§2.6), not the live record. That
 * is what the doctor told the centre, and it is what the centre answers.
 */
export default async function QueuePage() {
  const actor = await requireAccess('/centre/requests');
  const ctx = await useCaseContext(actor);

  const [queue, stock] = await Promise.all([
    listRequestsAwaitingDecision(ctx),
    stockByGroup(ctx),
  ]);

  const today = ctx.clock.today();
  const now = ctx.clock.now();
  const thresholds = ctx.config.request.responseMinutes;
  const onShelf = new Map(stock.map((row) => [row.bloodGroup, row.onShelf]));
  const needPatient = queue.filter((row) => row.awaitingPatient).length;

  return (
    <CentreShell actor={actor} title="Blood requests" current="requests">
      <div className="app-stack-tight">
        <h1 className="ux4g-heading-l-strong">Requests awaiting an answer</h1>
        <p className="ux4g-body-m-default">
          {/*
            Urgency first, not date: three of the four levels mean today, so a
            date could not tell an emergency from a routine request (ADR 0010).
          */}
          Most urgent first, then longest waiting. The stock column is red cells
          and whole blood held for that group, which is not the same as units of
          the exact component asked for — open a request to see that.
        </p>
      </div>

      {needPatient > 0 ? (
        <div className="ux4g-alert ux4g-alert-warning" role="status">
          <div className="ux4g-alert-content">
            <p className="ux4g-alert-message">
              {/*
                The counter's own work, surfaced rather than discovered one row
                at a time. A unit has to be traceable to a named person (§4).
              */}
              {needPatient}{' '}
              {needPatient === 1 ? 'request has' : 'requests have'} no patient yet.
              Take the details from the bystander before issuing.
            </p>
          </div>
        </div>
      ) : null}

      <section className="ux4g-card ux4g-card-outline">
        <div className="ux4g-card-body app-scroll-x">
          {queue.length === 0 ? (
            <p className="ux4g-body-s-default">
              Nothing waiting. Every submitted request has been answered.
            </p>
          ) : (
            <table className="ux4g-table">
              <thead>
                <tr>
                  <th scope="col">Request ID</th>
                  <th scope="col">Urgency</th>
                  <th scope="col">Waiting</th>
                  <th scope="col">Patient</th>
                  <th scope="col">Wanted</th>
                  <th scope="col">{WORDING.dateRequired}</th>
                  <th scope="col">Group stock</th>
                  <th scope="col">
                    <span className="app-sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {queue.map((request) => {
                  const overdue = request.dateRequired < today;
                  const urgency = isUrgency(request.urgency ?? '')
                    ? (request.urgency as Urgency)
                    : undefined;
                  /**
                   * The clock the top three urgencies actually run on.
                   *
                   * `date_required` cannot express "within fifteen minutes", so
                   * an unanswered emergency would not be flagged until midnight.
                   */
                  const late =
                    urgency !== undefined &&
                    isPastResponseTarget(urgency, request.submittedAt, now, thresholds);

                  return (
                    <tr key={request.id}>
                      <td className="app-figure">
                        <Link href={`/centre/requests/${request.id}`}>
                          {request.requestId}
                        </Link>
                      </td>
                      <td>{urgency ? URGENCY_SHORT[urgency] : '—'}</td>
                      <td className="app-figure">
                        {waitingLabel(minutesWaiting(request.submittedAt, now))}
                        {late ? (
                          <span className="ux4g-badge-digit-danger"> Late</span>
                        ) : null}
                      </td>
                      <td>
                        {request.awaitingPatient ? (
                          <span className="ux4g-label-m-default">no patient yet</span>
                        ) : (
                          (request.patient.name ?? '—')
                        )}
                      </td>
                      <td>
                        {request.units} × {productLabel(request.product)}{' '}
                        <span className="app-figure">
                          {bloodGroupLabel(request.bloodGroup)}
                        </span>
                      </td>
                      <td className="app-figure">
                        {request.dateRequired}
                        {overdue ? (
                          <span className="ux4g-badge-digit-danger"> Overdue</span>
                        ) : null}
                      </td>
                      <td className="app-figure">
                        {onShelf.get(request.bloodGroup) ?? 0}
                      </td>
                      <td>
                        <Link
                          className="ux4g-btn ux4g-btn-outline-primary ux4g-btn-md app-target"
                          href={`/centre/requests/${request.id}`}
                        >
                          {request.awaitingPatient ? 'Take details' : 'Answer'}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <Link className="ux4g-btn ux4g-btn-text-neutral ux4g-btn-md" href="/centre">
        Back to the overview
      </Link>
    </CentreShell>
  );
}
