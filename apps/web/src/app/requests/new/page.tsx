import type { Metadata } from 'next';
import Link from 'next/link';

import { Card } from '@blood-connect/ui';

import { KitShell } from '../../kit-shell';
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
  if (actor.kind !== 'user') return null;

  const query = await searchParams;

  const raw = query['admission'];
  const admissionId = typeof raw === 'string' && raw !== '' ? raw : undefined;

  /**
   * Only looked up when the doctor arrived from an admitted patient.
   *
   * The common path loads nothing at all. The form is four sets of buttons,
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
    <KitShell
      role={actor.role}
      currentPath="/requests/new"
      currentTitle="New request"
    >
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            New blood request
          </h1>
          <p className="text-sm text-ink-muted">
            Four answers, then an ID to give the patient&rsquo;s bystander.
          </p>
        </div>

        <Card>
          <RaiseRequestForm
            {...(admissionId !== undefined ? { admissionId } : {})}
            {...(patientName !== undefined ? { patientName } : {})}
          />
        </Card>

        <div>
          <Link
            href="/dashboard"
            className="text-sm font-medium text-ink-muted hover:text-ink hover:underline"
          >
            ← Cancel and go back
          </Link>
        </div>
      </div>
    </KitShell>
  );
}
