import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CentreShell } from '../../../centre-shell';
import { DecisionForm } from '../../../centre-forms';
import { requireAccess, useCaseContext } from '@/lib/guards';
import {
  availableUnits,
  getDecisionForRequest,
  listDecisionBags,
  listDemands,
} from '@blood-connect/centre';
import { admissionStateFor, getRequestForDecision } from '@blood-connect/hospital';
import {
  WORDING,
  bloodGroupLabel,
  productLabel,
  recruitsDonors,
} from '@blood-connect/domain';

export const metadata: Metadata = { title: 'Answer a request · Blood Connect' };

const DECISION_LABELS: Readonly<Record<string, string>> = {
  approved: 'Approved in full',
  partial: 'Partly approved',
  declined: 'Declined',
};

export default async function DecisionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireAccess(`/centre/requests/${id}`);
  const ctx = await useCaseContext(actor);

  const request = await getRequestForDecision(ctx, id);
  if (!request) notFound();

  const [available, decision, admission] = await Promise.all([
    availableUnits(ctx, request.bloodGroup, request.product),
    getDecisionForRequest(ctx, id),
    admissionStateFor(ctx, id),
  ]);

  const issued = decision ? await listDecisionBags(ctx, decision.id) : [];
  const demands = decision?.demandId
    ? (await listDemands(ctx)).filter((row) => row.id === decision.demandId)
    : [];

  const overdue = request.dateRequired < ctx.clock.today();
  const recruits = recruitsDonors(request.product);

  return (
    <CentreShell actor={actor} title={request.requestId} narrow>
      <div className="app-stack-tight">
        <h1 className="ux4g-heading-l-strong app-figure">{request.requestId}</h1>
        <p className="ux4g-body-m-default">
          {/*
            The snapshot, not the live patient record (§2.6). This is what the
            doctor told the centre when the request was made, and editing the
            patient since must not change what is answered here.
          */}
          The patient details below were recorded onto the request when it was
          submitted. They do not change afterwards.
        </p>
      </div>

      {overdue && !decision ? (
        <div className="ux4g-alert ux4g-alert-error" role="alert">
          <div className="ux4g-alert-content">
            <p className="ux4g-alert-message">
              This is past the day the blood was needed.
            </p>
          </div>
        </div>
      ) : null}

      {admission === 'none' ? (
        <div className="ux4g-alert ux4g-alert-warning" role="alert">
          <div className="ux4g-alert-content">
            <p className="ux4g-alert-message">
              {/*
                The ordinary state of a new request (ADR 0010), and the one this
                banner used to describe as a discharge — a different fact
                entirely, and a frightening one to read about a patient nobody
                had identified.
              */}
              <strong>No patient identified yet.</strong> The bystander has not
              brought the ID to the counter. Take their details before issuing —
              a unit has to be traceable to a named person.
            </p>
            {decision ? (
              <p className="ux4g-body-s-default">
                {/*
                  Emergency is the one urgency that may be decided first (ADR
                  0010), and the debt it leaves is shown as one until it is paid.
                */}
                This request was already answered without one, which only an
                emergency allows. Completing the patient is outstanding.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {admission === 'discharged' ? (
        <div className="ux4g-alert ux4g-alert-warning" role="status">
          <div className="ux4g-alert-content">
            <p className="ux4g-alert-message">
              {/*
                Shown, never enforced: a discharged patient can still need blood
                that was requested while they were on the ward.
              */}
              The patient has been discharged. The request still stands — check
              with the ward before issuing.
            </p>
          </div>
        </div>
      ) : null}

      <section className="ux4g-card ux4g-card-outline">
        <div className="ux4g-card-header">
          <h2 className="ux4g-card-title">{request.patient.name ?? 'Patient'}</h2>
          <p className="ux4g-card-sub-title app-figure">
            {WORDING.ipNumber} {request.patient.ipNo ?? '—'} · {WORDING.ward}{' '}
            {request.patient.ward ?? '—'} ·{' '}
            {request.patient.bloodGroup ? bloodGroupLabel(request.patient.bloodGroup as never) : '—'}
          </p>
        </div>
        <div className="ux4g-card-body">
          <dl className="app-stack-tight">
            <div className="app-row">
              <dt className="ux4g-label-m-strong">{WORDING.product}</dt>
              <dd className="ux4g-body-s-default">{productLabel(request.product)}</dd>
            </div>
            <div className="app-row">
              <dt className="ux4g-label-m-strong">{WORDING.units}</dt>
              <dd className="ux4g-body-s-default app-figure">{request.units}</dd>
            </div>
            <div className="app-row">
              <dt className="ux4g-label-m-strong">{WORDING.requestedBloodGroup}</dt>
              <dd className="ux4g-body-s-default app-figure">
                {bloodGroupLabel(request.bloodGroup)}
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
            <div className="app-stack-tight">
              <dt className="ux4g-label-m-strong">Requested by</dt>
              <dd className="ux4g-body-s-default">
                {request.doctor.fullName ?? '—'}
                {request.doctor.provisionalReg ? (
                  <span className="app-figure"> · {request.doctor.provisionalReg}</span>
                ) : null}
              </dd>
            </div>
            {request.patient.previousReaction ? (
              <div className="app-stack-tight">
                <dt className="ux4g-label-m-strong">{WORDING.previousReaction}</dt>
                <dd className="ux4g-body-s-default">{request.patient.previousReaction}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      </section>

      {decision ? (
        <section className="ux4g-card ux4g-card-outline">
          <div className="ux4g-card-header">
            <h2 className="ux4g-card-title">
              {DECISION_LABELS[decision.decision] ?? decision.decision}
            </h2>
            <p className="ux4g-card-sub-title">
              {decision.unitsIssued} of {decision.unitsRequested} units issued.
            </p>
          </div>
          <div className="ux4g-card-body app-stack">
            {decision.note ? (
              <p className="ux4g-body-s-default">{decision.note}</p>
            ) : null}

            {issued.length > 0 ? (
              <div className="app-scroll-x">
                <table className="ux4g-table">
                  <thead>
                    <tr>
                      <th scope="col">{WORDING.unitNumber}</th>
                      <th scope="col">{WORDING.expiresOn}</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {issued.map((bag) => (
                      <tr key={bag.id}>
                        <td className="app-figure">{bag.unitNumber}</td>
                        <td className="app-figure">{bag.expiresAt}</td>
                        <td>{bag.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="ux4g-label-m-default">
                  {/*
                    Which unit went to which patient is a question a transfusion
                    service has to answer years later (§4).
                  */}
                  These units are held for this request until they leave the fridge.
                </p>
              </div>
            ) : null}

            {demands.map((demand) => (
              <div key={demand.id} className="ux4g-alert ux4g-alert-info" role="status">
                <div className="ux4g-alert-content">
                  <p className="ux4g-alert-message">
                    A {WORDING.donorDemand.toLowerCase()} for {demand.units} units of{' '}
                    {bloodGroupLabel(demand.bloodGroup as never)} was raised with this
                    answer.{' '}
                    <Link href="/centre/demands">See recruitment</Link>.
                  </p>
                </div>
              </div>
            ))}

            <p className="ux4g-label-m-default">
              {/*
                One decision per request, enforced by a unique constraint. A
                correction is a new action against the request, not an edit of
                this row.
              */}
              A decision is not edited. If this was wrong, the request is answered
              again by the ward raising a new one.
            </p>
          </div>
        </section>
      ) : (
        <section className="ux4g-card ux4g-card-outline">
          <div className="ux4g-card-header">
            <h2 className="ux4g-card-title">Answer this request</h2>
            <p className="ux4g-card-sub-title">
              {available} units of {productLabel(request.product)}{' '}
              {bloodGroupLabel(request.bloodGroup)} are on the shelf right now.
            </p>
          </div>
          <div className="ux4g-card-body">
            <DecisionForm
              requestUuid={request.id}
              units={request.units}
              available={available}
              recruits={recruits}
            />
          </div>
        </section>
      )}

      <Link className="ux4g-btn ux4g-btn-text-neutral ux4g-btn-md" href="/centre/requests">
        Back to the queue
      </Link>
    </CentreShell>
  );
}
