import type { Metadata } from 'next';
import Link from 'next/link';

import { AppShell } from '../shell';
import { RequestEmailChangeForm } from '../forms';
import { RequestUpdateForm } from '../request-update-form';
import {
  cancelEmailChangeAction,
  requestAccountUpdateAction,
  requestEmailChangeAction,
  withdrawAccountUpdateAction,
} from '../actions';
import { requireAccess, useCaseContext } from '@/lib/guards';
import {
  UPDATE_REQUEST_LABELS,
  findAccountById,
  listMyUpdateRequests,
} from '@blood-connect/platform';
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

  const updates = await listMyUpdateRequests(await useCaseContext(actor));
  const waiting = updates.filter((row) => row.status === 'pending');
  const decided = updates.filter(
    (row) => row.status === 'approved' || row.status === 'rejected',
  );

  return (
    <AppShell actor={actor} title="Your profile">
      <div className="app-stack-tight">
        <h1 className="ux4g-heading-l-strong">Your profile</h1>
        <p className="ux4g-body-m-default">
          Your name and registration number appear on every request you raise, so an
          administrator agrees to a change before it applies. Your address and your
          password are yours to change.
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
          <h2 className="ux4g-card-title">Ask to change your name or registration</h2>
          <p className="ux4g-card-sub-title">
            An administrator decides, and the change is applied for you.
          </p>
        </div>
        <div className="ux4g-card-body app-stack">
          {waiting.length > 0 && (
            <ul className="app-stack-tight app-plain-list">
              {waiting.map((row) => (
                <li key={row.id}>
                  <div className="ux4g-alert ux4g-alert-info" role="status">
                    <div className="ux4g-alert-content">
                      <p className="ux4g-alert-message">
                        Waiting on your administrator: {UPDATE_REQUEST_LABELS[row.field]} to
                        read {row.proposedValue}.
                      </p>
                    </div>
                  </div>
                  {/*
                    Every request in flight has a way out. A request that can
                    only be decided by somebody else, with nothing the person
                    can do, is the dead end §8 forbids.
                  */}
                  <form action={withdrawAccountUpdateAction}>
                    <input type="hidden" name="requestId" value={row.id} />
                    <button
                      type="submit"
                      className="ux4g-btn ux4g-btn-outline-danger ux4g-btn-md app-target"
                    >
                      Withdraw it
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          {decided.length > 0 && (
            <ul className="app-stack-tight app-plain-list">
              {decided.map((row) => (
                <li key={row.id}>
                  <div
                    className={
                      row.status === 'approved'
                        ? 'ux4g-alert ux4g-alert-success'
                        : 'ux4g-alert ux4g-alert-warning'
                    }
                    role="status"
                  >
                    <div className="ux4g-alert-content">
                      <p className="ux4g-alert-message">
                        {row.status === 'approved'
                          ? `${UPDATE_REQUEST_LABELS[row.field]} now reads ${row.proposedValue}.`
                          : `${UPDATE_REQUEST_LABELS[row.field]} was not changed. ${row.adminNote ?? ''}`}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <RequestUpdateForm
            action={requestAccountUpdateAction}
            currentName={account?.fullName ?? ''}
            currentReg={account?.provisionalReg ?? ''}
          />
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
