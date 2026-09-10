import type { Metadata } from 'next';
import Link from 'next/link';

import { AppShell } from '../shell';
import { requireAccess, useCaseContext } from '@/lib/guards';
import {
  isOverdue,
  listAdmissions,
  listRequestsForDoctor,
} from '@blood-connect/hospital';
import {
  URGENCY_SHORT,
  WORDING,
  bloodGroupLabel,
  isUrgency,
  productLabel,
  type BloodGroup,
  type Urgency,
} from '@blood-connect/domain';
import { StartRequestButton } from '../request-buttons';

export const metadata: Metadata = { title: 'Dashboard · Blood Connect' };

const STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  partially_approved: 'Partly approved',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

export default async function DashboardPage() {
  // Layer 2 of §13. The proxy already decided this; the page decides it again.
  const actor = await requireAccess('/dashboard');
  if (actor.kind !== 'user') return null;

  const ctx = await useCaseContext(actor);
  const [requests, admissions] = await Promise.all([
    listRequestsForDoctor(ctx, actor.userId),
    listAdmissions(ctx),
  ]);

  const today = ctx.clock.today();
  // No drafts any more (ADR 0010): a request is submitted or it never existed.
  const live = requests.filter((r) => r.status !== 'draft');
  const open = admissions.filter((a) => a.status === 'admitted');

  return (
    <AppShell actor={actor} title="Dashboard">
      <div className="app-row-split">
        <div className="app-stack-tight">
          <h1 className="ux4g-heading-l-strong">Blood requests</h1>
          <p className="ux4g-body-m-default">
            {/*
              What the doctor's job now is, in one line (ADR 0010). The patient
              is the centre's to identify, and saying so here is what stops
              somebody opening the optional section out of habit.
            */}
            Four answers and an ID. Give the ID to the patient&rsquo;s bystander. The
            blood centre takes it from there.
          </p>
        </div>
        <Link
          className="ux4g-btn ux4g-btn-primary ux4g-btn-lg app-target"
          href="/requests/new"
        >
          New request
        </Link>
      </div>

      <section className="ux4g-card ux4g-card-outline" aria-labelledby="live">
        <div className="ux4g-card-header">
          <h2 className="ux4g-card-title" id="live">
            Submitted requests
          </h2>
        </div>
        <div className="ux4g-card-body app-scroll-x">
          {live.length === 0 ? (
            <p className="ux4g-body-s-default">Nothing submitted yet.</p>
          ) : (
            <table className="ux4g-table">
              <thead>
                <tr>
                  <th scope="col">Request ID</th>
                  <th scope="col">Urgency</th>
                  <th scope="col">Wanted</th>
                  <th scope="col">Patient</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {live.map((request) => (
                  <tr key={request.id}>
                    <td className="app-figure">
                      <Link href={`/requests/${request.id}`}>{request.requestId}</Link>
                    </td>
                    <td>
                      {isUrgency(request.urgency ?? '')
                        ? URGENCY_SHORT[request.urgency as Urgency]
                        : '-'}
                    </td>
                    <td>
                      {request.units} ×{' '}
                      {request.product ? productLabel(request.product) : '-'}{' '}
                      {request.bloodGroup ? bloodGroupLabel(request.bloodGroup) : ''}
                    </td>
                    <td>
                      {/*
                        Empty until the centre attaches one, which is the
                        ordinary case (ADR 0010). Said in words, because a blank
                        cell reads as a bug rather than as a state.
                      */}
                      {request.patientName ?? (
                        <span className="ux4g-label-m-default">
                          with the bystander
                        </span>
                      )}
                    </td>
                    <td>
                      {STATUS_LABELS[request.status] ?? request.status}
                      {/*
                        Overdue is derived, never stored (§3): true the moment
                        the day passes, not whenever a job next runs.
                      */}
                      {isOverdue(request, today) ? (
                        <span className="ux4g-badge-digit-danger"> Overdue</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="ux4g-card ux4g-card-outline" aria-labelledby="admitted">
        <div className="ux4g-card-header">
          <h2 className="ux4g-card-title" id="admitted">
            Admitted patients
          </h2>
          <p className="ux4g-card-sub-title">Start a request from an admission.</p>
        </div>
        <div className="ux4g-card-body app-scroll-x">
          {open.length === 0 ? (
            <p className="ux4g-body-s-default">
              No open admissions. Record a patient to begin.
            </p>
          ) : (
            <table className="ux4g-table">
              <thead>
                <tr>
                  <th scope="col">Patient</th>
                  <th scope="col">{WORDING.ipNumber}</th>
                  <th scope="col">{WORDING.ward}</th>
                  <th scope="col">Group</th>
                  <th scope="col">
                    <span className="app-sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {open.map((admission) => (
                  <tr key={admission.id}>
                    <td>
                      <Link href={`/admissions/${admission.id}`}>
                        {admission.patientName}
                      </Link>
                    </td>
                    <td className="app-figure">{admission.ipNo}</td>
                    <td>{admission.ward}</td>
                    <td className="app-figure">
                      {bloodGroupLabel(admission.bloodGroup as BloodGroup)}
                    </td>
                    <td>
                      <StartRequestButton admissionId={admission.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </AppShell>
  );
}
