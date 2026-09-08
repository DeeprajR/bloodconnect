import type { Metadata } from 'next';

import { AppShell } from '../../shell';
import { AdmissionForm } from '../../hospital-forms';
import { requireAccess } from '@/lib/guards';

export const metadata: Metadata = { title: 'New admission · Blood Connect' };

export default async function NewAdmissionPage({
  searchParams,
}: {
  searchParams: Promise<{ patientId?: string }>;
}) {
  const actor = await requireAccess('/admissions/new');
  const { patientId } = await searchParams;

  if (!patientId) {
    return (
      <AppShell actor={actor} title="New admission" narrow>
        <div className="ux4g-alert ux4g-alert-error" role="alert">
          <div className="ux4g-alert-content">
            <p className="ux4g-alert-message">Start from a patient record.</p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell actor={actor} title="New admission" narrow>
      <div className="ux4g-card ux4g-card-outline">
        <div className="ux4g-card-header">
          <h1 className="ux4g-card-title">Admit the patient</h1>
        </div>
        <div className="ux4g-card-body">
          <AdmissionForm patientId={patientId} />
        </div>
      </div>
    </AppShell>
  );
}
