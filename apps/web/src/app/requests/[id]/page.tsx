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

import { KitShell } from '../../kit-shell';
import { CancelRequestForm, SampleForm } from '../../hospital-forms';
import { requireAccess, useCaseContext } from '@/lib/guards';
import { getRequest, listSamples } from '@blood-connect/hospital';
import { getDecisionForRequest } from '@blood-connect/centre';
import {
  URGENCY_LABELS,
  URGENCY_SHORT,
  WORDING,
  bloodGroupLabel,
  isUrgency,
  productLabel,
  responseMinutesFor,
  type BloodGroup,
  type Product,
  type Urgency,
} from '@blood-connect/domain';

export const metadata: Metadata = { title: 'Blood request · Blood Connect' };

const STATUS_LABELS: Readonly<Record<string, string>> = {
  submitted: 'Submitted, waiting for the blood centre',
  approved: 'Approved',
  partially_approved: 'Partly approved',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

const URGENCY_TONES: Readonly<Record<Urgency, 'danger' | 'warning' | 'neutral'>> = {
  emergency: 'danger',
  very_urgent: 'warning',
  urgent: 'warning',
  routine: 'neutral',
};

/** The statuses §3 lets a doctor cancel from. A draft is left, not cancelled. */
const CANCELLABLE = ['submitted', 'approved', 'partially_approved'];

type Sample = Awaited<ReturnType<typeof listSamples>>[number];

/**
 * A draft is editable; anything else is a record.
 *
 * One route rather than two, because the doctor arrives at the same place
 * either way, from the dashboard, or from having just submitted. What
 * changes is whether there is a form on it.
 */
export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  // Straight off the form. The ID is the only thing the doctor came for.
  const justRaised = query['raised'] === '1';
  const actor = await requireAccess(`/requests/${id}`);
  if (actor.kind !== 'user') return null;

  const ctx = await useCaseContext(actor);

  const row = await getRequest(ctx, id);
  if (!row) notFound();

  const { request } = row;

  // Rendered from the snapshot, not from the live patient record. That is
  // the whole point of freezing it (§2.6). Empty until the centre attaches
  // one.
  const patient = (request.patientSnapshot ?? {}) as Record<string, string | null>;
  const doctor = (request.doctorSnapshot ?? {}) as Record<string, string | null>;

  // The centre's answer, once there is one. Read through Module 2's own API.
  const decision = await getDecisionForRequest(ctx, id);
  const samples = await listSamples(ctx, id);
  const canCancel = CANCELLABLE.includes(request.status);

  /**
   * The priority, beside the identifier rather than buried in the detail list.
   *
   * The two travel together: the bystander carries the ID to the counter, and
   * how fast it gets answered is the other half of what the counter needs to
   * know. Three of the four levels land on today (ADR 0010), so the date beside
   * it cannot say this and the level has to.
   */
  const urgency = isUrgency(request.urgency ?? '')
    ? (request.urgency as Urgency)
    : undefined;
  const answerMinutes =
    urgency === undefined
      ? null
      : responseMinutesFor(urgency, ctx.config.request.responseMinutes);

  const when = new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });

  const sampleColumns: Column<Sample>[] = [
    {
      key: 'identifier',
      header: 'Identifier',
      cell: (s) => (
        <span className="font-mono tabular-nums text-ink">
          {s.sampleIdentifier}
        </span>
      ),
    },
    {
      key: 'collectedAt',
      header: 'Collected',
      cell: (s) => (
        <span className="tabular-nums">{when.format(s.collectedAt)}</span>
      ),
    },
    { key: 'by', header: 'By', cell: (s) => s.collectedBy ?? '—' },
    { key: 'note', header: 'Note', cell: (s) => s.note ?? '—' },
  ];

  return (
    <KitShell
      role={actor.role}
      currentPath={`/requests/${id}`}
      currentTitle={request.requestId ?? 'Blood request'}
    >
      {justRaised ? (
        /**
         * The handoff (ADR 0010).
         *
         * Big enough to read across a bed, because that is what happens
         * next: the doctor says it to the patient's bystander, who carries
         * it to the blood centre. Everything else on this page is for
         * later.
         */
        <div
          className="rounded-card border border-primary/30 bg-primary-soft p-6 text-center"
          role="status"
        >
          <p className="text-sm font-medium text-primary">
            Give this to the patient&rsquo;s bystander
          </p>
          <p className="mt-2 font-mono text-3xl font-bold tabular-nums tracking-wider text-ink sm:text-4xl">
            {request.requestId}
          </p>
          {urgency ? (
            <p className="mt-2 flex flex-wrap items-center justify-center gap-2 text-sm text-ink-muted">
              <StatusBadge label={URGENCY_SHORT[urgency]} tone={URGENCY_TONES[urgency]} />
              <span>
                {answerMinutes === null
                  ? 'Answered in the order the queue reaches it'
                  : `The centre is asked to answer within ${String(answerMinutes)} minutes`}
              </span>
            </p>
          ) : null}
          <p className="mt-3 text-sm text-ink-muted">
            They take it to the blood centre, who will ask them for the
            patient&rsquo;s details. Nothing else is needed from you.
          </p>
        </div>
      ) : null}

      <PageHeader
        title={request.requestId ?? 'Blood request'}
        description={STATUS_LABELS[request.status] ?? request.status}
        actions={
          urgency ? (
            <StatusBadge label={URGENCY_SHORT[urgency]} tone={URGENCY_TONES[urgency]} />
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="What was asked for">
          <DescList
            items={[
              {
                term: WORDING.product,
                value: request.product
                  ? productLabel(request.product as Product)
                  : '—',
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
                  <span className="tabular-nums">
                    {request.bloodGroup
                      ? bloodGroupLabel(request.bloodGroup as BloodGroup)
                      : '—'}
                  </span>
                ),
              },
              {
                term: 'Priority',
                value: urgency ? URGENCY_LABELS[urgency] : '—',
              },
              {
                term: WORDING.dateRequired,
                value: (
                  <span className="tabular-nums">{request.dateRequired}</span>
                ),
              },
              {
                term: WORDING.indication,
                value: request.indication,
              },
            ]}
          />
        </Card>

        <Card title="Patient, as recorded at submit">
          <p className="mb-3 text-xs text-ink-subtle">
            A snapshot. Later edits to the patient record do not change it.
          </p>
          <DescList
            items={[
              { term: WORDING.patientName, value: patient['name'] ?? '—' },
              {
                term: WORDING.ipNumber,
                value: (
                  <span className="tabular-nums">
                    {patient['ipNo'] ?? '—'}
                  </span>
                ),
              },
              { term: WORDING.ward, value: patient['ward'] ?? '—' },
              {
                term: 'Requested by',
                value: (
                  <>
                    {doctor['fullName']}
                    {doctor['provisionalReg']
                      ? ` · ${doctor['provisionalReg']}`
                      : ''}
                  </>
                ),
              },
            ]}
          />
        </Card>
      </div>

      {decision ? (
        <Card
          title={`What the ${WORDING.bloodCentre.toLowerCase()} answered`}
          actions={
            <span className="text-xs tabular-nums text-ink-subtle">
              {decision.unitsIssued} of {decision.unitsRequested}{' '}
              {WORDING.units.toLowerCase()}
            </span>
          }
        >
          <div className="space-y-1.5">
            {decision.note ? (
              <p className="text-sm text-ink">{decision.note}</p>
            ) : null}
            {decision.demandId ? (
              <p className="text-sm text-ink-muted">
                {/*
                  The shortfall recruits donors, and the doctor should know
                  it. Cancelling now reaches real people who agreed to come
                  in.
                */}
                Donors are being asked for the units the shelf could not
                cover.
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}

      <Card title={WORDING.crossmatchSample}>
        <p className="mb-4 text-xs text-ink-subtle">
          {/*
            §15: the identifier is unique across the hospital, because it
            travels on a tube between the ward and the laboratory.
          */}
          The identifier is unique across the hospital. More than one sample
          can be recorded against a request.
        </p>

        {samples.length > 0 ? (
          <div className="mb-4">
            <DataTable
              columns={sampleColumns}
              rows={samples}
              getRowKey={(s) => s.id}
            />
          </div>
        ) : null}

        {request.status !== 'cancelled' ? (
          <SampleForm requestUuid={request.id} />
        ) : null}
      </Card>

      {request.status === 'cancelled' ? (
        <div
          role="status"
          className="rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-ink"
        >
          <p>
            <span className="font-medium text-warning">Cancelled:</span>{' '}
            {request.cancelReason}
          </p>
        </div>
      ) : null}

      {canCancel ? (
        <Card title="No longer needed?">
          <p className="mb-4 text-xs text-ink-subtle">
            {/*
              §3: the one post-submit action a doctor has, "and without it
              the centre chases units nobody needs".
            */}
            The patient improved, died, was referred, or it was raised in
            error.
          </p>
          <CancelRequestForm
            requestUuid={request.id}
            hasDecision={decision !== undefined}
          />
        </Card>
      ) : null}

      <div>
        <Link
          href="/dashboard"
          className="text-sm font-medium text-ink-muted hover:text-ink hover:underline"
        >
          ← Back to the dashboard
        </Link>
      </div>
    </KitShell>
  );
}
