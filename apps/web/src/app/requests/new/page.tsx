import type { Metadata } from 'next';
import Link from 'next/link';

import { AppShell } from '../../shell';
import { RaiseRequestForm } from '../../raise-request-form';
import { requireAccess, useCaseContext } from '@/lib/guards';
import { listAdmissions } from '@blood-connect/hospital';

export const metadata: Metadata = { title: 'New request · Blood Connect' };

/**
 * The doctor's one screen (§3, ADR 0010).
 *
 * Four answers and an ID. Everything else about the request is the blood
 * centre's to collect from the patient's bystander, so it sits behind one
 * disclosure that starts closed.
 */
export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAccess('/requests/new');
  const query = await searchParams;

  const raw = query['admission'];
  const admissionId = typeof raw === 'string' && raw !== '' ? raw : undefined;

  /**
   * Only looked up when the doctor arrived from an admitted patient.
   *
   * The common path loads nothing at all — the form is four sets of buttons,
   * and a query on the way to it would be latency spent on the case that does
   * not need it.
   */
  let patientName: string | undefined;
  if (admissionId !== undefined) {
    const ctx = await useCaseContext(actor);
    const admissions = await listAdmissions(ctx);
    patientName = admissions.find((row) => row.id === admissionId)?.patientName;
  }

  return (
    <AppShell actor={actor} title="New request" narrow>
      <div className="app-stack-tight">
        <h1 className="ux4g-heading-l-strong">New blood request</h1>
        <p className="ux4g-body-m-default">
          Four answers, then an ID to give the patient&rsquo;s bystander.
        </p>
      </div>

      <RaiseRequestForm admissionId={admissionId} patientName={patientName} />

      <Link className="ux4g-btn ux4g-btn-text-neutral ux4g-btn-md" href="/dashboard">
        Cancel
      </Link>
    </AppShell>
  );
}
