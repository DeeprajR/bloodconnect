import type { Metadata } from 'next';
import Link from 'next/link';

import {
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  StatusBadge,
  type Column,
} from '@blood-connect/ui';

import { KitShell } from '../kit-shell';
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

/**
 * The kit's `Button` renders a `<button>`, but the primary action here
 * is navigation. Rather than adding a `LinkButton` primitive to the kit
 * for one caller, the classes match `Button` `variant="primary"` /
 * `size="md"` — the kit's Tailwind utilities are available here.
 */
const LINK_BUTTON =
  'inline-flex h-10 items-center justify-center gap-2 rounded-control ' +
  'border border-transparent bg-primary px-4 text-sm font-medium text-white no-underline ' +
  'transition-colors hover:bg-primary-hover ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';

type LiveRequest = Awaited<
  ReturnType<typeof listRequestsForDoctor>
>[number];
type Admission = Awaited<ReturnType<typeof listAdmissions>>[number];

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

  const requestColumns: Column<LiveRequest>[] = [
    {
      key: 'id',
      header: 'Request ID',
      cell: (r) => (
        <Link
          href={`/requests/${r.id}`}
          className="font-medium text-primary hover:underline"
        >
          {r.requestId}
        </Link>
      ),
    },
    {
      key: 'urgency',
      header: 'Urgency',
      cell: (r) =>
        isUrgency(r.urgency ?? '')
          ? URGENCY_SHORT[r.urgency as Urgency]
          : '—',
    },
    {
      key: 'wanted',
      header: 'Wanted',
      cell: (r) => (
        <>
          {r.units} × {r.product ? productLabel(r.product) : '—'}{' '}
          {r.bloodGroup ? bloodGroupLabel(r.bloodGroup) : ''}
        </>
      ),
    },
    {
      key: 'patient',
      header: 'Patient',
      cell: (r) =>
        r.patientName ?? (
          <span className="text-ink-subtle">with the bystander</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (
        <span className="inline-flex items-center gap-2">
          {STATUS_LABELS[r.status] ?? r.status}
          {isOverdue(r, today) && (
            <StatusBadge label="Overdue" tone="danger" />
          )}
        </span>
      ),
    },
  ];

  const admissionColumns: Column<Admission>[] = [
    {
      key: 'patient',
      header: 'Patient',
      cell: (a) => (
        <Link
          href={`/admissions/${a.id}`}
          className="font-medium text-primary hover:underline"
        >
          {a.patientName}
        </Link>
      ),
    },
    {
      key: 'ip',
      header: WORDING.ipNumber,
      cell: (a) => <span className="tabular-nums">{a.ipNo}</span>,
    },
    { key: 'ward', header: WORDING.ward, cell: (a) => a.ward },
    {
      key: 'group',
      header: 'Group',
      cell: (a) => (
        <span className="tabular-nums">
          {bloodGroupLabel(a.bloodGroup as BloodGroup)}
        </span>
      ),
    },
    {
      key: 'action',
      header: '',
      mobileLabel: 'Action',
      align: 'right',
      cell: (a) => <StartRequestButton admissionId={a.id} />,
    },
  ];

  return (
    <KitShell role={actor.role} currentPath="/dashboard" currentTitle="Dashboard">
      <PageHeader
        title="Blood requests"
        description="Four answers and an ID. Give the ID to the patient’s bystander. The blood centre takes it from there."
        actions={
          <Link href="/requests/new" className={LINK_BUTTON}>
            New request
          </Link>
        }
      />

      <Card title="Submitted requests">
        {live.length === 0 ? (
          <EmptyState
            title="Nothing submitted yet"
            description="Start with New request when a bystander is with you."
          />
        ) : (
          <DataTable
            columns={requestColumns}
            rows={live}
            getRowKey={(r) => r.id}
          />
        )}
      </Card>

      <Card
        title="Admitted patients"
        actions={
          <span className="text-xs text-ink-subtle">
            Start a request from an admission.
          </span>
        }
      >
        {open.length === 0 ? (
          <EmptyState
            title="No open admissions"
            description="Record a patient to begin."
          />
        ) : (
          <DataTable
            columns={admissionColumns}
            rows={open}
            getRowKey={(a) => a.id}
          />
        )}
      </Card>
    </KitShell>
  );
}
