import type { Metadata } from 'next';

import { Card } from '@blood-connect/ui';

import { KitShell } from '../../kit-shell';
import { AdmissionForm } from '../../hospital-forms';
import { requireAccess } from '@/lib/guards';

export const metadata: Metadata = { title: 'New admission · Blood Connect' };

export default async function NewAdmissionPage({
  searchParams,
}: {
  searchParams: Promise<{ patientId?: string }>;
}) {
  const actor = await requireAccess('/admissions/new');
  if (actor.kind !== 'user') return null;
  const { patientId } = await searchParams;

  if (!patientId) {
    return (
      <KitShell role={actor.role} currentPath="/admissions/new" currentTitle="New admission">
        <p
          role="alert"
          className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          Start from a patient record.
        </p>
      </KitShell>
    );
  }

  return (
    <KitShell role={actor.role} currentPath="/admissions/new" currentTitle="New admission">
      <div className="mx-auto w-full max-w-2xl">
        <Card title="Admit the patient">
          <AdmissionForm patientId={patientId} />
        </Card>
      </div>
    </KitShell>
  );
}
