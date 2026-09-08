import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { AppShell } from '../../shell';
import { StartRequestButton, DischargeButton } from '../../request-buttons';
import { requireAccess } from '@/lib/guards';
import { db } from '@blood-connect/platform';
import { admissions, patients } from '@blood-connect/db';
import { WORDING, bloodGroupLabel, type BloodGroup } from '@blood-connect/domain';

export const metadata: Metadata = { title: 'Admission · Blood Connect' };

export default async function AdmissionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireAccess(`/admissions/${id}`);

  const [row] = await db
    .select({ admission: admissions, patient: patients })
    .from(admissions)
    .innerJoin(patients, eq(patients.id, admissions.patientId))
    .where(eq(admissions.id, id));

  if (!row) notFound();

  return (
    <AppShell actor={actor} title={row.patient.name}>
      <div className="app-row-split">
        <div className="app-stack-tight">
          <h1 className="ux4g-heading-l-strong">{row.patient.name}</h1>
          <p className="ux4g-body-m-default app-figure">
            {WORDING.ipNumber} {row.admission.ipNo} · {WORDING.ward} {row.admission.ward} ·{' '}
            {bloodGroupLabel(row.patient.bloodGroup as BloodGroup)}
          </p>
        </div>
        <div className="app-row">
          <StartRequestButton admissionId={row.admission.id} />
          {row.admission.status === 'admitted' ? (
            <DischargeButton admissionId={row.admission.id} />
          ) : null}
        </div>
      </div>

      <section className="ux4g-card ux4g-card-outline">
        <div className="ux4g-card-body">
          <dl className="app-stack-tight">
            <div className="app-row">
              <dt className="ux4g-label-m-strong">{WORDING.age}</dt>
              <dd className="ux4g-body-s-default app-figure">
                {row.patient.age !== null
                  ? `${row.patient.age} ${row.patient.ageUnit ?? ''}`
                  : (row.patient.dob ?? '—')}
              </dd>
            </div>
            <div className="app-row">
              <dt className="ux4g-label-m-strong">{WORDING.hospitalId}</dt>
              <dd className="ux4g-body-s-default app-figure">{row.patient.uhid ?? '—'}</dd>
            </div>
            <div className="app-row">
              <dt className="ux4g-label-m-strong">{WORDING.knownDiagnosis}</dt>
              <dd className="ux4g-body-s-default">{row.patient.diagnosis ?? '—'}</dd>
            </div>
            <div className="app-row">
              <dt className="ux4g-label-m-strong">{WORDING.previousTransfusion}</dt>
              <dd className="ux4g-body-s-default">{row.patient.previousTransfusion}</dd>
            </div>
          </dl>
        </div>
      </section>

      <Link className="ux4g-btn ux4g-btn-text-neutral ux4g-btn-md" href="/dashboard">
        Back to the dashboard
      </Link>
    </AppShell>
  );
}
