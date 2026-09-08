import type { Metadata } from 'next';
import Link from 'next/link';

import { AppShell } from '../../shell';
import { requireAccess, useCaseContext } from '@/lib/guards';
import { stockByGroup } from '@blood-connect/centre';
import { listRequestsAwaitingDecision } from '@blood-connect/hospital';
import { WORDING, bloodGroupLabel, productLabel } from '@blood-connect/domain';

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
  const onShelf = new Map(stock.map((row) => [row.bloodGroup, row.onShelf]));

  return (
    <AppShell actor={actor} title="Request queue">
      <div className="app-stack-tight">
        <h1 className="ux4g-heading-l-strong">Requests awaiting an answer</h1>
        <p className="ux4g-body-m-default">
          Soonest needed first. The stock column is red cells and whole blood held
          for that group, which is not the same as units of the exact component
          asked for — open a request to see that.
        </p>
      </div>

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
                  <th scope="col">Patient</th>
                  <th scope="col">{WORDING.ward}</th>
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
                  return (
                    <tr key={request.id}>
                      <td className="app-figure">
                        <Link href={`/centre/requests/${request.id}`}>
                          {request.requestId}
                        </Link>
                      </td>
                      <td>{request.patient.name ?? '—'}</td>
                      <td>{request.patient.ward ?? '—'}</td>
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
                          Answer
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
    </AppShell>
  );
}
