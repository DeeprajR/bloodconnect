import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  Card,
  DataTable,
  DescList,
  PageHeader,
  StatusBadge,
  type Column,
} from '@blood-connect/ui';

import { CentreShell } from '../../../centre-shell';
import { DecisionForm } from '../../../centre-forms';
import { requireAccess, useCaseContext } from '@/lib/guards';
import {
  availableUnits,
  getDecisionForRequest,
  listDecisionBags,
  listDemands,
} from '@blood-connect/centre';
import {
  admissionStateFor,
  getRequestForDecision,
} from '@blood-connect/hospital';
import { AttachPatientForm } from '../../../attach-patient-form';
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

type IssuedBag = Awaited<ReturnType<typeof listDecisionBags>>[number];

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

  const bagColumns: Column<IssuedBag>[] = [
    {
      key: 'unit',
      header: WORDING.unitNumber,
      cell: (b) => (
        <span className="font-mono tabular-nums">{b.unitNumber}</span>
      ),
    },
    {
      key: 'expires',
      header: WORDING.expiresOn,
      cell: (b) => (
        <span className="font-mono tabular-nums">{b.expiresAt}</span>
      ),
    },
    { key: 'status', header: 'Status', cell: (b) => b.status },
  ];

  return (
    <CentreShell
      current="requests"
      actor={actor}
      title={request.requestId}
      narrow
    >
      <PageHeader
        title={request.requestId}
        description={
          // The snapshot, not the live patient record (§2.6). This is
          // what the doctor told the centre when the request was made,
          // and editing the patient since must not change what is
          // answered here.
          'The patient details below were recorded onto the request when it was submitted. They do not change afterwards.'
        }
      />

      {overdue && !decision ? (
        <div
          role="alert"
          className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          This is past the day the blood was needed.
        </div>
      ) : null}

      {admission === 'none' ? (
        <Card title="Who is this for?">
          <p className="mb-4 text-xs text-ink-subtle">
            {/*
              The whole reason the bystander walked over here (ADR
              0010). It is the first thing on the page because until it
              is done the request cannot be answered.
            */}
            The doctor gave four fields and an ID. Take the patient&rsquo;s
            details from whoever brought it.
          </p>
          <AttachPatientForm requestUuid={id} />
        </Card>
      ) : null}

      {admission === 'none' ? (
        <div
          role="alert"
          className="space-y-1 rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-ink"
        >
          <p>
            {/*
              The ordinary state of a new request (ADR 0010), and the
              one this banner used to describe as a discharge. A
              different fact entirely, and a frightening one to read
              about a patient nobody had identified.
            */}
            <span className="font-medium text-warning">
              No patient identified yet.
            </span>{' '}
            The bystander has not brought the ID to the counter. Take
            their details before issuing. A unit has to be traceable to
            a named person.
          </p>
          {decision ? (
            <p className="text-ink-muted">
              {/*
                Emergency is the one urgency that may be decided first
                (ADR 0010), and the debt it leaves is shown as one
                until it is paid.
              */}
              This request was already answered without one, which only
              an emergency allows. Completing the patient is
              outstanding.
            </p>
          ) : null}
        </div>
      ) : null}

      {admission === 'discharged' ? (
        <div
          role="status"
          className="rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-ink"
        >
          {/*
            Shown, never enforced: a discharged patient can still need
            blood that was requested while they were on the ward.
          */}
          The patient has been discharged. The request still stands.
          Check with the ward before issuing.
        </div>
      ) : null}

      <Card
        title={request.patient.name ?? 'Patient'}
        actions={
          <span className="font-mono text-xs tabular-nums text-ink-subtle">
            {WORDING.ipNumber} {request.patient.ipNo ?? '—'} · {WORDING.ward}{' '}
            {request.patient.ward ?? '—'} ·{' '}
            {request.patient.bloodGroup
              ? bloodGroupLabel(request.patient.bloodGroup as never)
              : '—'}
          </span>
        }
      >
        <DescList
          items={[
            {
              term: WORDING.product,
              value: productLabel(request.product),
            },
            {
              term: WORDING.units,
              value: (
                <span className="tabular-nums">{request.units}</span>
              ),
            },
            {
              term: WORDING.requestedBloodGroup,
              value: (
                <span className="font-mono tabular-nums">
                  {bloodGroupLabel(request.bloodGroup)}
                </span>
              ),
            },
            {
              term: WORDING.dateRequired,
              value: (
                <span className="font-mono tabular-nums">
                  {request.dateRequired}
                </span>
              ),
            },
            {
              term: WORDING.indication,
              value: request.indication,
            },
            {
              term: 'Requested by',
              value: (
                <>
                  {request.doctor.fullName ?? '—'}
                  {request.doctor.provisionalReg ? (
                    <span className="font-mono tabular-nums">
                      {' '}
                      · {request.doctor.provisionalReg}
                    </span>
                  ) : null}
                </>
              ),
            },
            ...(request.patient.previousReaction
              ? [
                  {
                    term: WORDING.previousReaction,
                    value: request.patient.previousReaction,
                  },
                ]
              : []),
          ]}
        />
      </Card>

      {decision ? (
        <Card
          title={DECISION_LABELS[decision.decision] ?? decision.decision}
          actions={
            <StatusBadge
              tone={
                decision.decision === 'approved'
                  ? 'success'
                  : decision.decision === 'declined'
                    ? 'danger'
                    : 'warning'
              }
              label={`${String(decision.unitsIssued)} of ${String(decision.unitsRequested)} units`}
            />
          }
        >
          <div className="space-y-4">
            {decision.note ? (
              <p className="text-sm text-ink">{decision.note}</p>
            ) : null}

            {issued.length > 0 ? (
              <div className="space-y-2">
                <DataTable
                  columns={bagColumns}
                  rows={issued}
                  getRowKey={(b) => b.id}
                />
                <p className="text-xs text-ink-muted">
                  {/*
                    Which unit went to which patient is a question a
                    transfusion service has to answer years later (§4).
                  */}
                  These units are held for this request until they leave
                  the fridge.
                </p>
              </div>
            ) : null}

            {demands.map((demand) => (
              <div
                key={demand.id}
                role="status"
                className="rounded-control border border-info/30 bg-info-soft px-3 py-2 text-sm text-ink"
              >
                A {WORDING.donorDemand.toLowerCase()} for{' '}
                <span className="tabular-nums">{demand.units}</span> units of{' '}
                {bloodGroupLabel(demand.bloodGroup as never)} was raised with
                this answer.{' '}
                <Link
                  href="/centre/demands"
                  className="font-medium text-primary hover:underline"
                >
                  See recruitment
                </Link>
                .
              </div>
            ))}

            <p className="text-xs text-ink-muted">
              {/*
                One decision per request, enforced by a unique
                constraint. A correction is a new action against the
                request, not an edit of this row.
              */}
              A decision is not edited. If this was wrong, the request
              is answered again by the ward raising a new one.
            </p>
          </div>
        </Card>
      ) : (
        <Card
          title="Answer this request"
          actions={
            <span className="text-xs text-ink-subtle">
              <span className="font-mono tabular-nums">{available}</span>{' '}
              units of {productLabel(request.product)}{' '}
              <span className="font-mono tabular-nums">
                {bloodGroupLabel(request.bloodGroup)}
              </span>{' '}
              on the shelf
            </span>
          }
        >
          <DecisionForm
            requestUuid={request.id}
            units={request.units}
            available={available}
            recruits={recruits}
          />
        </Card>
      )}

      <div>
        <Link
          href="/centre/requests"
          className="text-sm font-medium text-ink-muted hover:text-ink hover:underline"
        >
          ← Back to the queue
        </Link>
      </div>
    </CentreShell>
  );
}
