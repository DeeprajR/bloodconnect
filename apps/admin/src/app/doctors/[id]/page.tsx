import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AppShell } from '../../shell';
import { ChangeEmailForm, EditDoctorForm, SealForm } from '../../forms';
import { removeSealAction, resendInviteAction, setStatusAction } from '../../actions';
import { requireAccess, useCaseContext } from '@/lib/guards';
import { getDoctor } from '@blood-connect/platform';
import { getPatientsForDoctor } from '@blood-connect/hospital';

export const metadata: Metadata = { title: 'Doctor · Administration' };

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

  return (
    <AppShell actor={actor} title={doctor.fullName}>
      <div className="app-stack-tight">
        <h1 className="ux4g-heading-l-strong">{doctor.fullName}</h1>
        <p className="ux4g-body-m-default">
          {doctor.status === 'pending_activation'
            ? 'Invited. They have not set a password yet.'
            : doctor.status === 'deactivated'
              ? 'Deactivated. They cannot sign in and every session has ended.'
              : 'Active.'}
        </p>
      </div>

      <div className="app-grid">
        <section className="ux4g-card ux4g-card-outline">
          <div className="ux4g-card-header">
            <h2 className="ux4g-card-title">Details</h2>
          </div>
          <div className="ux4g-card-body">
            <EditDoctorForm
              userId={doctor.id}
              fullName={doctor.fullName}
              provisionalReg={doctor.provisionalReg}
            />
          </div>
        </section>

        <section className="ux4g-card ux4g-card-outline">
          <div className="ux4g-card-header">
            <h2 className="ux4g-card-title">Email address</h2>
          </div>
          <div className="ux4g-card-body">
            <ChangeEmailForm userId={doctor.id} currentEmail={doctor.email} />
          </div>
        </section>

        <section className="ux4g-card ux4g-card-outline">
          <div className="ux4g-card-header">
            <h2 className="ux4g-card-title">Seal</h2>
          </div>
          <div className="ux4g-card-body app-stack">
            {doctor.hasSeal ? (
              <>
                {/*
                  Served through an authenticated route, never a public URL. A
                  signature anyone can fetch is a signature anyone can reuse.
                */}
                <img
                  src={`/api/seal/${doctor.id}`}
                  alt={`Seal for ${doctor.fullName}`}
                  style={{ maxHeight: 120, background: 'var(--ux4g-bg-neutral-elevated)' }}
                />
                <form action={clearSeal}>
                  <button
                    type="submit"
                    className="ux4g-btn ux4g-btn-outline-danger ux4g-btn-md app-target"
                  >
                    Remove seal
                  </button>
                </form>
              </>
            ) : (
              <p className="ux4g-body-s-default">No seal uploaded.</p>
            )}
            <SealForm userId={doctor.id} />
          </div>
        </section>

        <section className="ux4g-card ux4g-card-outline">
          <div className="ux4g-card-header">
            <h2 className="ux4g-card-title">Access</h2>
          </div>
          <div className="ux4g-card-body app-stack">
            {doctor.status === 'pending_activation' ? (
              <form action={resend}>
                <button
                  type="submit"
                  className="ux4g-btn ux4g-btn-outline-primary ux4g-btn-md app-target"
                >
                  Send the invite again
                </button>
                <p className="ux4g-label-m-default">
                  This replaces the earlier link, which stops working.
                </p>
              </form>
            ) : null}

            {doctor.status === 'deactivated' ? (
              <form action={reactivate}>
                <button
                  type="submit"
                  className="ux4g-btn ux4g-btn-outline-primary ux4g-btn-md app-target"
                >
                  Reactivate
                </button>
              </form>
            ) : (
              <form action={deactivate}>
                <button
                  type="submit"
                  className="ux4g-btn ux4g-btn-outline-danger ux4g-btn-md app-target"
                >
                  Deactivate
                </button>
                <p className="ux4g-label-m-default">
                  Ends every session immediately. The record is kept.
                </p>
              </form>
            )}
          </div>
        </section>
      </div>

      <section className="ux4g-card ux4g-card-outline">
        <div className="ux4g-card-header">
          <h2 className="ux4g-card-title">Patients</h2>
          <p className="ux4g-card-sub-title">
            This doctor’s patients, live and historical. Opening this page is recorded in
            the audit log, naming every record shown.
          </p>
        </div>
        <div className="ux4g-card-body app-scroll-x">
          {patients === undefined ? (
            <p className="ux4g-body-s-default">
              This account cannot read patient records.
            </p>
          ) : patients.length === 0 ? (
            <p className="ux4g-body-s-default">
              This doctor has not requested blood for anyone yet.
            </p>
          ) : (
            <table className="ux4g-table">
              <thead>
                <tr>
                  <th scope="col">Patient</th>
                  <th scope="col">Hospital ID</th>
                  <th scope="col">IP number</th>
                  <th scope="col">Ward</th>
                  <th scope="col">Group</th>
                  <th scope="col">Status</th>
                  <th scope="col">Requests</th>
                  <th scope="col">Known diagnosis</th>
                </tr>
              </thead>
              <tbody>
                {patients.map((patient) => (
                  <tr key={`${patient.patientId}-${patient.ipNo}`}>
                    <td>{patient.name}</td>
                    <td className="app-figure">{patient.uhid ?? '-'}</td>
                    <td className="app-figure">{patient.ipNo}</td>
                    <td>{patient.ward}</td>
                    <td className="app-figure">{patient.bloodGroup}</td>
                    <td>
                      {patient.admissionStatus === 'admitted' ? 'Live' : 'Discharged'}
                    </td>
                    <td className="app-figure">{patient.requestCount}</td>
                    <td>{patient.diagnosis ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <Link className="ux4g-btn ux4g-btn-text-neutral ux4g-btn-md" href="/doctors">
        Back to the list
      </Link>
    </AppShell>
  );
}
