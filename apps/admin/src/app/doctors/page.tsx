import type { Metadata } from 'next';
import Link from 'next/link';

import { AppShell } from '../shell';
import { requireAccess, useCaseContext } from '@/lib/guards';
import { listDoctors } from '@blood-connect/platform';

export const metadata: Metadata = { title: 'Doctors · Administration' };

const STATUS_LABELS = {
  active: 'Active',
  pending_activation: 'Invited, not yet activated',
  deactivated: 'Deactivated',
} as const;

const dayFormat = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
});

/** Whole days, so an invite that is ageing is obvious at a glance (§8). */
const daysSince = (from: Date, now: Date): number =>
  Math.floor((now.getTime() - from.getTime()) / 86_400_000);

export default async function DoctorsPage() {
  const actor = await requireAccess('/doctors');
  const ctx = await useCaseContext(actor);
  const doctors = await listDoctors(ctx);
  const now = new Date();

  return (
    <AppShell actor={actor} title="Doctors">
      <div className="app-row" style={{ justifyContent: 'space-between' }}>
        <div className="app-stack-tight">
          <h1 className="ux4g-heading-l-strong">Doctors</h1>
          <p className="ux4g-body-m-default app-figure">
            {doctors.length} record{doctors.length === 1 ? '' : 's'}
          </p>
        </div>
        <Link
          className="ux4g-btn ux4g-btn-primary ux4g-btn-md app-target"
          href="/doctors/new"
        >
          Add a doctor
        </Link>
      </div>

      {doctors.length === 0 ? (
        <div className="ux4g-alert ux4g-alert-info" role="status">
          <div className="ux4g-alert-content">
            <p className="ux4g-alert-message">
              No doctors yet. Adding one sends them an invite to set a password.
            </p>
          </div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="ux4g-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Registration</th>
                <th scope="col">Status</th>
                <th scope="col">Seal</th>
                <th scope="col">Added</th>
              </tr>
            </thead>
            <tbody>
              {doctors.map((doctor) => {
                const waiting =
                  doctor.status === 'pending_activation'
                    ? daysSince(doctor.createdAt, now)
                    : null;

                return (
                  <tr key={doctor.id}>
                    <td>
                      <Link href={`/doctors/${doctor.id}`}>{doctor.fullName}</Link>
                    </td>
                    <td>{doctor.email}</td>
                    <td className="app-figure">{doctor.provisionalReg ?? '—'}</td>
                    <td>
                      {STATUS_LABELS[doctor.status]}
                      {/*
                        An invite that was never used ages visibly rather than
                        rotting silently (§8).
                      */}
                      {waiting !== null && waiting > 0 ? (
                        <span className="ux4g-label-m-default"> · {waiting}d</span>
                      ) : null}
                    </td>
                    <td>{doctor.hasSeal ? 'Yes' : '—'}</td>
                    <td className="app-figure">{dayFormat.format(doctor.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
