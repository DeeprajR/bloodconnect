import type { Metadata } from 'next';
import Link from 'next/link';

import { Card } from '@blood-connect/ui';

import { KitShell } from '../../kit-shell';
import { PatientForm } from './form';
import { requireAccess } from '@/lib/guards';

export const metadata: Metadata = { title: 'New patient · Blood Connect' };

export default async function NewPatientPage() {
  const actor = await requireAccess('/patients/new');
  if (actor.kind !== 'user') return null;

  return (
    <KitShell
      role={actor.role}
      currentPath="/patients/new"
      currentTitle="New patient"
    >
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            Record a patient
          </h1>
          <p className="text-sm text-ink-muted">
            Then create the admission. A request is always made against an
            admission.
          </p>
        </div>

        <Card>
          <PatientForm />
        </Card>

        <div>
          <Link
            href="/dashboard"
            className="text-sm font-medium text-ink-muted hover:text-ink hover:underline"
          >
            ← Back to the dashboard
          </Link>
        </div>
      </div>
    </KitShell>
  );
}
