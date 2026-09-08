import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AppShell } from '../../shell';
import { CancelRequestForm, DraftForm, SampleForm } from '../../hospital-forms';
import { requireAccess, useCaseContext } from '@/lib/guards';
import { getRequest, listSamples } from '@blood-connect/hospital';
import { getDecisionForRequest } from '@blood-connect/centre';
import {
  WORDING,
  bloodGroupLabel,
  productLabel,
  type BloodGroup,
  type Product,
} from '@blood-connect/domain';

export const metadata: Metadata = { title: 'Blood request · Blood Connect' };

const STATUS_LABELS: Readonly<Record<string, string>> = {
  submitted: 'Submitted, waiting for the blood centre',
  approved: 'Approved',
  partially_approved: 'Partly approved',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

/** The statuses §3 lets a doctor cancel from. A draft is left, not cancelled. */
const CANCELLABLE = ['submitted', 'approved', 'partially_approved'];

/**
 * A draft is editable; anything else is a record.
 *
 * One route rather than two, because the doctor arrives at the same place
 * either way — from the dashboard, or from having just submitted. What changes
 * is whether there is a form on it.
 */
export default async function RequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireAccess(`/requests/${id}`);
  const ctx = await useCaseContext(actor);

  const row = await getRequest(ctx, id);
  if (!row) notFound();

  const { request } = row;

  if (request.status === 'draft') {
    return (
      <AppShell actor={actor} title="Blood request" narrow>
        <div className="ux4g-card ux4g-card-outline">
          <div className="ux4g-card-header">
            <h1 className="ux4g-card-title">{WORDING.bloodRequest}</h1>
            <p className="ux4g-card-sub-title">
              {row.patient.name} · {WORDING.ipNumber} {row.admission.ipNo} ·{' '}
              {WORDING.ward} {row.admission.ward} ·{' '}
              {bloodGroupLabel(row.patient.bloodGroup as BloodGroup)}
            </p>
          </div>
          <div className="ux4g-card-body">
            <DraftForm
              requestUuid={request.id}
              indication={request.indication ?? ''}
              dateRequired={request.dateRequired ?? ctx.clock.today()}
              bloodGroup={request.bloodGroup ?? row.patient.bloodGroup}
              product={request.product ?? 'whole_blood'}
              units={request.units ?? 1}
            />
          </div>
          <div className="ux4g-card-footer">
            <Link className="ux4g-btn ux4g-btn-text-neutral ux4g-btn-md" href="/dashboard">
              Back to the dashboard
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  // Everything past draft renders from the snapshot, not from the live patient
  // record — that is the whole point of freezing it (§2.6).
  const patient = (request.patientSnapshot ?? {}) as Record<string, string | null>;
  const doctor = (request.doctorSnapshot ?? {}) as Record<string, string | null>;

  // The centre's answer, once there is one. Read through Module 2's own API.
  const decision = await getDecisionForRequest(ctx, id);
  const samples = await listSamples(ctx, id);
  const canCancel = CANCELLABLE.includes(request.status);

  const when = new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });

  return (
    <AppShell actor={actor} title={request.requestId ?? 'Blood request'}>
      <div className="app-stack-tight">
        <h1 className="ux4g-heading-l-strong app-figure">{request.requestId}</h1>
        <p className="ux4g-body-m-default">
          {STATUS_LABELS[request.status] ?? request.status}
        </p>
      </div>

      <div className="app-grid">
        <section className="ux4g-card ux4g-card-outline">
          <div className="ux4g-card-header">
            <h2 className="ux4g-card-title">What was asked for</h2>
          </div>
          <div className="ux4g-card-body">
            <dl className="app-stack-tight">
              <div className="app-row">
                <dt className="ux4g-label-m-strong">{WORDING.product}</dt>
                <dd className="ux4g-body-s-default">
                  {request.product ? productLabel(request.product as Product) : '—'}
                </dd>
              </div>
              <div className="app-row">
                <dt className="ux4g-label-m-strong">{WORDING.units}</dt>
                <dd className="ux4g-body-s-default app-figure">{request.units}</dd>
              </div>
              <div className="app-row">
                <dt className="ux4g-label-m-strong">{WORDING.requestedBloodGroup}</dt>
                <dd className="ux4g-body-s-default app-figure">
                  {request.bloodGroup
                    ? bloodGroupLabel(request.bloodGroup as BloodGroup)
                    : '—'}
                </dd>
              </div>
              <div className="app-row">
                <dt className="ux4g-label-m-strong">{WORDING.dateRequired}</dt>
                <dd className="ux4g-body-s-default app-figure">{request.dateRequired}</dd>
              </div>
              <div className="app-stack-tight">
                <dt className="ux4g-label-m-strong">{WORDING.indication}</dt>
                <dd className="ux4g-body-s-default">{request.indication}</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="ux4g-card ux4g-card-outline">
          <div className="ux4g-card-header">
            <h2 className="ux4g-card-title">Patient, as recorded at submit</h2>
            <p className="ux4g-card-sub-title">
              A snapshot. Later edits to the patient record do not change it.
            </p>
          </div>
          <div className="ux4g-card-body">
            <dl className="app-stack-tight">
              <div className="app-row">
                <dt className="ux4g-label-m-strong">{WORDING.patientName}</dt>
                <dd className="ux4g-body-s-default">{patient['name']}</dd>
              </div>
              <div className="app-row">
                <dt className="ux4g-label-m-strong">{WORDING.ipNumber}</dt>
                <dd className="ux4g-body-s-default app-figure">{patient['ipNo']}</dd>
              </div>
              <div className="app-row">
                <dt className="ux4g-label-m-strong">{WORDING.ward}</dt>
                <dd className="ux4g-body-s-default">{patient['ward']}</dd>
              </div>
              <div className="app-row">
                <dt className="ux4g-label-m-strong">Requested by</dt>
                <dd className="ux4g-body-s-default">
                  {doctor['fullName']}
                  {doctor['provisionalReg'] ? ` · ${doctor['provisionalReg']}` : ''}
                </dd>
              </div>
            </dl>
          </div>
        </section>
      </div>

      {decision ? (
        <section className="ux4g-card ux4g-card-outline">
          <div className="ux4g-card-header">
            <h2 className="ux4g-card-title">What the {WORDING.bloodCentre.toLowerCase()} answered</h2>
            <p className="ux4g-card-sub-title app-figure">
              {decision.unitsIssued} of {decision.unitsRequested} {WORDING.units.toLowerCase()}
            </p>
          </div>
          <div className="ux4g-card-body app-stack-tight">
            {decision.note ? (
              <p className="ux4g-body-s-default">{decision.note}</p>
            ) : null}
            {decision.demandId ? (
              <p className="ux4g-body-s-default">
                {/*
                  The shortfall recruits donors, and the doctor should know it —
                  cancelling now reaches real people who agreed to come in.
                */}
                Donors are being asked for the units the shelf could not cover.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="ux4g-card ux4g-card-outline">
        <div className="ux4g-card-header">
          <h2 className="ux4g-card-title">{WORDING.crossmatchSample}</h2>
          <p className="ux4g-card-sub-title">
            {/*
              §15: the identifier is unique across the hospital, because it
              travels on a tube between the ward and the laboratory.
            */}
            The identifier is unique across the hospital. More than one sample can
            be recorded against a request.
          </p>
        </div>

        {samples.length > 0 ? (
          <div className="ux4g-card-body app-scroll-x">
            <table className="ux4g-table">
              <thead>
                <tr>
                  <th scope="col">Identifier</th>
                  <th scope="col">Collected</th>
                  <th scope="col">By</th>
                  <th scope="col">Note</th>
                </tr>
              </thead>
              <tbody>
                {samples.map((sample) => (
                  <tr key={sample.id}>
                    <td className="app-figure">{sample.sampleIdentifier}</td>
                    <td className="app-figure">{when.format(sample.collectedAt)}</td>
                    <td>{sample.collectedBy ?? '—'}</td>
                    <td>{sample.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {request.status !== 'cancelled' ? (
          <div className="ux4g-card-body">
            <SampleForm requestUuid={request.id} />
          </div>
        ) : null}
      </section>

      {request.status === 'cancelled' ? (
        <div className="ux4g-alert ux4g-alert-warning" role="status">
          <div className="ux4g-alert-content">
            <p className="ux4g-alert-message">
              Cancelled: {request.cancelReason}
            </p>
          </div>
        </div>
      ) : null}

      {canCancel ? (
        <section className="ux4g-card ux4g-card-outline">
          <div className="ux4g-card-header">
            <h2 className="ux4g-card-title">No longer needed?</h2>
            <p className="ux4g-card-sub-title">
              {/*
                §3: the one post-submit action a doctor has, "and without it the
                centre chases units nobody needs".
              */}
              The patient improved, died, was referred, or it was raised in error.
            </p>
          </div>
          <div className="ux4g-card-body">
            <CancelRequestForm requestUuid={request.id} hasDecision={decision !== undefined} />
          </div>
        </section>
      ) : null}

      <Link className="ux4g-btn ux4g-btn-text-neutral ux4g-btn-md" href="/dashboard">
        Back to the dashboard
      </Link>
    </AppShell>
  );
}
