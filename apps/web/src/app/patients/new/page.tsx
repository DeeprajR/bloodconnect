import type { Metadata } from 'next';
import Link from 'next/link';

import { AppShell } from '../../shell';
import { PatientForm } from '../../hospital-forms';
import { requireAccess } from '@/lib/guards';

export const metadata: Metadata = { title: 'New patient · Blood Connect' };

export default async function NewPatientPage() {
  const actor = await requireAccess('/patients/new');

  return (
    <AppShell actor={actor} title="New patient" narrow>
      <div className="ux4g-card ux4g-card-outline">
        <div className="ux4g-card-header">
          <h1 className="ux4g-card-title">Record a patient</h1>
          <p className="ux4g-card-sub-title">
            Then create the admission. A request is always made against an admission.
          </p>
        </div>
        <div className="ux4g-card-body">
          <PatientForm />
        </div>
        <div className="ux4g-card-footer">
          <Link className="ux4g-btn ux4g-btn-text-neutral ux4g-btn-md" href="/dashboard">
            Back to the dashboard
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
