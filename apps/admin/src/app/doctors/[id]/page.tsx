import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  Button,
  Card,
  DataTable,
  PageHeader,
  StatusBadge,
  type Column,
} from '@blood-connect/ui';

import { KitShell } from '../../kit-shell';
import { ChangeEmailForm, EditDoctorForm, SealForm } from '../../forms';
import { removeSealAction, resendInviteAction, setStatusAction } from '../../actions';
import { requireAccess, useCaseContext } from '@/lib/guards';
import { getDoctor } from '@blood-connect/platform';
import { getPatientsForDoctor } from '@blood-connect/hospital';

export const metadata: Metadata = { title: 'Doctor · Administration' };

type PatientRow = NonNullable<
  Awaited<ReturnType<typeof getPatientsForDoctor>>
>[number];

export default async function DoctorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireAccess(`/doctors/${id}`);
  const ctx = await useCaseContext(actor);

  const doctor = await getDoctor(ctx, id);
  if (!doctor) notFound();

  // Requires `patients:read_all`, and writes an audit row naming every record
  // it returned. See ADR 0003: this is the system's largest disclosure surface.
  const patients = await getPatientsForDoctor(ctx, id);

  const resend = resendInviteAction.bind(null, id);
  const deactivate = setStatusAction.bind(null, id, 'deactivated');
  const reactivate = setStatusAction.bind(null, id, 'active');
  const clearSeal = removeSealAction.bind(null, id);

  const patientColumns: Column<PatientRow>[] = [
    { key: 'name', header: 'Patient', cell: (p) => p.name },
    {
      key: 'uhid',
      header: 'Hospital ID',
      cell: (p) => <span className="tabular-nums">{p.uhid ?? '–'}</span>,
    },
    {
      key: 'ip',
      header: 'IP number',
      cell: (p) => <span className="tabular-nums">{p.ipNo}</span>,
    },
    { key: 'ward', header: 'Ward', cell: (p) => p.ward },
    {
      key: 'group',
      header: 'Group',
      cell: (p) => <span className="tabular-nums">{p.bloodGroup}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (p) => (
        <StatusBadge
          label={p.admissionStatus === 'admitted' ? 'Live' : 'Discharged'}
          tone={p.admissionStatus === 'admitted' ? 'success' : 'neutral'}
        />
      ),
    },
    {
      key: 'requests',
      header: 'Requests',
      cell: (p) => <span className="tabular-nums">{p.requestCount}</span>,
    },
    { key: 'diagnosis', header: 'Known diagnosis', cell: (p) => p.diagnosis ?? '–' },
  ];

  return (
    <KitShell currentPath="/doctors" currentTitle={doctor.fullName}>
      <PageHeader
        title={doctor.fullName}
        description={
          doctor.status === 'pending_activation'
            ? 'Invited. They have not set a password yet.'
            : doctor.status === 'deactivated'
              ? 'Deactivated. They cannot sign in and every session has ended.'
              : 'Active.'
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Details">
          <EditDoctorForm
            userId={doctor.id}
            fullName={doctor.fullName}
            provisionalReg={doctor.provisionalReg}
          />
        </Card>

        <Card title="Email address">
          <ChangeEmailForm userId={doctor.id} currentEmail={doctor.email} />
        </Card>

        <Card title="Seal">
          <div className="space-y-4">
            {doctor.hasSeal ? (
              <>
                {/*
                  Served through an authenticated route, never a public URL. A
                  signature anyone can fetch is a signature anyone can reuse.
                */}
                <img
                  src={`/api/seal/${doctor.id}`}
                  alt={`Seal for ${doctor.fullName}`}
                  className="max-h-32 rounded-control border border-border bg-surface-muted"
                />
                <form action={clearSeal}>
                  <Button type="submit" variant="danger" size="sm">
                    Remove seal
                  </Button>
                </form>
              </>
            ) : (
              <p className="text-sm text-ink-muted">No seal uploaded.</p>
            )}
            <SealForm userId={doctor.id} />
          </div>
        </Card>

        <Card title="Access">
          <div className="space-y-3">
            {doctor.status === 'pending_activation' ? (
              <form action={resend} className="space-y-1.5">
                <Button type="submit" variant="secondary" size="sm">
                  Send the invite again
                </Button>
                <p className="text-xs text-ink-subtle">
                  This replaces the earlier link, which stops working.
                </p>
              </form>
            ) : null}

            {doctor.status === 'deactivated' ? (
              <form action={reactivate}>
                <Button type="submit" variant="secondary" size="sm">
                  Reactivate
                </Button>
              </form>
            ) : (
              <form action={deactivate} className="space-y-1.5">
                <Button type="submit" variant="danger" size="sm">
                  Deactivate
                </Button>
                <p className="text-xs text-ink-subtle">
                  Ends every session immediately. The record is kept.
                </p>
              </form>
            )}
          </div>
        </Card>
      </div>

      <Card title="Patients">
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">
            This doctor’s patients, live and historical. Opening this page is
            recorded in the audit log, naming every record shown.
          </p>
          {patients === undefined ? (
            <p className="text-sm text-ink-muted">
              This account cannot read patient records.
            </p>
          ) : (
            <DataTable
              columns={patientColumns}
              rows={patients}
              getRowKey={(p) => `${p.patientId}-${p.ipNo}`}
              emptyLabel="This doctor has not requested blood for anyone yet."
            />
          )}
        </div>
      </Card>

      <Link
        href="/doctors"
        className="text-sm font-medium text-ink-muted hover:text-ink hover:underline"
      >
        ← Back to the list
      </Link>
    </KitShell>
  );
}
