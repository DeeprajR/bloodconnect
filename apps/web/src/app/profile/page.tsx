import type { Metadata } from 'next';
import Link from 'next/link';

import { AppShell } from '../shell';
import { RequestEmailChangeForm } from '../forms';
import { cancelEmailChangeAction, requestEmailChangeAction } from '../actions';
import { requireAccess } from '@/lib/guards';
import { findAccountById } from '@blood-connect/platform';
import { db } from '@blood-connect/platform';
import { emailChangeRequests } from '@blood-connect/db';
import { and, eq, isNull } from 'drizzle-orm';

export const metadata: Metadata = { title: 'Your profile · Blood Connect' };

export default async function ProfilePage() {
  const actor = await requireAccess('/profile');
  if (actor.kind !== 'user') return null;

  const account = await findAccountById(db, actor.userId);

  const [pending] = await db
    .select({
      newEmail: emailChangeRequests.newEmail,
      expiresAt: emailChangeRequests.expiresAt,
    })
    .from(emailChangeRequests)
    .where(
      and(
        eq(emailChangeRequests.userId, actor.userId),
        isNull(emailChangeRequests.consumedAt),
        isNull(emailChangeRequests.supersededAt),
        isNull(emailChangeRequests.cancelledAt),
      ),
    );

  return (
    <AppShell actor={actor} title="Your profile">
      <div className="app-stack-tight">
        <h1 className="ux4g-heading-l-strong">Your profile</h1>
        <p className="ux4g-body-m-default">
          Your name, registration number and seal are held by your administrator. Your
          address and your password are yours to change.
        </p>
      </div>

      <section className="ux4g-card ux4g-card-outline">
        <div className="ux4g-card-header">
          <h2 className="ux4g-card-title">Your details</h2>
        </div>
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

      <section className="ux4g-card ux4g-card-outline">
        <div className="ux4g-card-header">
          <h2 className="ux4g-card-title">Change your email address</h2>
          <p className="ux4g-card-sub-title">
            You confirm it yourself, from the new address. Nobody else approves it.
          </p>
        </div>
        <div className="ux4g-card-body">
          {pending ? (
            <div className="app-stack">
              {/*
                A change in flight is shown with a way out. The third ending of
                this flow is withdrawing it, and a request that can only be
                completed or abandoned silently is the dead end §8 forbids.
              */}
              <div className="ux4g-alert ux4g-alert-info" role="status">
                <div className="ux4g-alert-content">
                  <p className="ux4g-alert-message">
                    Waiting for {pending.newEmail} to confirm. Your account keeps its
                    current address until then.
                  </p>
                </div>
              </div>
              <form action={cancelEmailChangeAction}>
                <button
                  type="submit"
                  className="ux4g-btn ux4g-btn-outline-danger ux4g-btn-md app-target"
                >
                  Cancel this change
                </button>
              </form>
            </div>
          ) : (
            <RequestEmailChangeForm
              action={requestEmailChangeAction}
              currentEmail={account?.email ?? ''}
            />
          )}
        </div>
      </section>

      <section className="ux4g-card ux4g-card-outline">
        <div className="ux4g-card-header">
          <h2 className="ux4g-card-title">Change your password</h2>
          <p className="ux4g-card-sub-title">
            Uses the same six-digit code as a reset, sent to your address.
          </p>
        </div>
        <div className="ux4g-card-footer">
          <Link className="ux4g-btn ux4g-btn-outline-primary ux4g-btn-md app-target" href="/reset">
            Change password
          </Link>
        </div>
      </section>
    </AppShell>
  );
}
