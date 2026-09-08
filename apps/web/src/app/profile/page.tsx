import type { Metadata } from 'next';

import { AppShell } from '../shell';
import { requireAccess } from '@/lib/guards';
import { findAccountById } from '@/modules/platform';
import { db } from '@/db/client';

export const metadata: Metadata = { title: 'Your profile · Blood Connect' };

export default async function ProfilePage() {
  const actor = await requireAccess('/profile');
  if (actor.kind !== 'user') return null;

  const account = await findAccountById(db, actor.userId);

  return (
    <AppShell actor={actor} title="Your profile">
      <div className="app-stack-tight">
        <h1 className="ux4g-heading-l-strong">Your profile</h1>
        <p className="ux4g-body-m-default">
          Name, email and registration number are changed by request to an administrator
          rather than edited here (§3). That queue arrives in phase 5.
        </p>
      </div>

      <section className="ux4g-card ux4g-card-outline">
        <div className="ux4g-card-body">
          <dl className="app-stack-tight">
            <div className="app-row">
              <dt className="ux4g-label-m-strong">Name</dt>
              <dd className="ux4g-body-s-default">{account?.fullName ?? '—'}</dd>
            </div>
            <div className="app-row">
              <dt className="ux4g-label-m-strong">Email</dt>
              <dd className="ux4g-body-s-default">{account?.email ?? '—'}</dd>
            </div>
            <div className="app-row">
              <dt className="ux4g-label-m-strong">Registration</dt>
              <dd className="ux4g-body-s-default app-figure">
                {account?.provisionalReg ?? 'Not recorded'}
              </dd>
            </div>
          </dl>
        </div>
      </section>
    </AppShell>
  );
}
