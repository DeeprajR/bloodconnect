import type { Metadata } from 'next';
import Link from 'next/link';

import { AppShell } from '../../shell';
import { CreateDoctorForm } from '../../forms';
import { requireAccess } from '@/lib/guards';

export const metadata: Metadata = { title: 'Add a doctor · Administration' };

export default async function NewDoctorPage() {
  const actor = await requireAccess('/doctors/new');

  return (
    <AppShell actor={actor} title="Add a doctor" narrow>
      <div className="ux4g-card ux4g-card-outline">
        <div className="ux4g-card-header">
          <h1 className="ux4g-card-title">Add a doctor</h1>
          <p className="ux4g-card-sub-title">
            They receive an email with a single-use link and set their own password.
          </p>
        </div>
        <div className="ux4g-card-body">
          <CreateDoctorForm />
        </div>
        <div className="ux4g-card-footer">
          <Link className="ux4g-btn ux4g-btn-text-neutral ux4g-btn-md" href="/doctors">
            Back to the list
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
