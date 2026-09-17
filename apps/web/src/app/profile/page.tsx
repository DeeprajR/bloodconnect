import type { Metadata } from 'next';
import Link from 'next/link';

import { Button, Card, DescList, PageHeader, linkButtonClasses } from '@blood-connect/ui';

import { KitShell } from '../kit-shell';
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

// The link-button chrome for the "Change password" card. A <Link> can't
// render a <button>, so `linkButtonClasses` (PR-11a) gives it <Button>'s
// `variant="secondary"` shape instead.
const LINK_SECONDARY = linkButtonClasses({ variant: 'secondary' });

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
    <KitShell role={actor.role} currentPath="/profile" currentTitle="Your profile">
      <PageHeader
        title="Your profile"
        description="Your name and registration number appear on every request you raise, so an administrator agrees to a change before it applies. Your address and your password are yours to change."
      />

      <Card title="Your details">
        <DescList
          items={[
            { term: 'Name', value: account?.fullName ?? '—' },
            { term: 'Email', value: account?.email ?? '—' },
            {
              term: 'Registration',
              value: (
                <span className="tabular-nums">
                  {account?.provisionalReg ?? 'Not recorded'}
                </span>
              ),
            },
          ]}
        />
      </Card>

      <Card title="Change your email address">
        <p className="mb-4 text-xs text-ink-subtle">
          You confirm it yourself, from the new address. Nobody else approves
          it.
        </p>
        {pending ? (
          <div className="space-y-3">
            {/*
              A change in flight is shown with a way out. The third ending
              of this flow is withdrawing it, and a request that can only
              be completed or abandoned silently is the dead end §8
              forbids.
            */}
            <p
              role="status"
              className="rounded-control border border-info/30 bg-info-soft px-3 py-2 text-sm text-ink"
            >
              Waiting for{' '}
              <span className="font-medium">{pending.newEmail}</span> to
              confirm. Your account keeps its current address until then.
            </p>
            <form action={cancelEmailChangeAction}>
              <Button type="submit" variant="danger" size="sm">
                Cancel this change
              </Button>
            </form>
          </div>
        ) : (
          <RequestEmailChangeForm
            action={requestEmailChangeAction}
            currentEmail={account?.email ?? ''}
          />
        )}
      </Card>

      <Card title="Ask to change your name or registration">
        <p className="mb-4 text-xs text-ink-subtle">
          An administrator decides, and the change is applied for you.
        </p>
        <div className="space-y-4">
          {waiting.length > 0 && (
            <ul className="space-y-3">
              {waiting.map((row) => (
                <li key={row.id} className="space-y-2">
                  <p
                    role="status"
                    className="rounded-control border border-info/30 bg-info-soft px-3 py-2 text-sm text-ink"
                  >
                    Waiting on your administrator:{' '}
                    <span className="font-medium">
                      {UPDATE_REQUEST_LABELS[row.field]}
                    </span>{' '}
                    to read{' '}
                    <span className="font-medium">{row.proposedValue}</span>.
                  </p>
                  {/*
                    Every request in flight has a way out. A request that
                    can only be decided by somebody else, with nothing the
                    person can do, is the dead end §8 forbids.
                  */}
                  <form action={withdrawAccountUpdateAction}>
                    <input type="hidden" name="requestId" value={row.id} />
                    <Button type="submit" variant="danger" size="sm">
                      Withdraw it
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          {decided.length > 0 && (
            <ul className="space-y-2">
              {decided.map((row) => (
                <li key={row.id}>
                  <p
                    role="status"
                    className={
                      row.status === 'approved'
                        ? 'rounded-control border border-success/30 bg-success-soft px-3 py-2 text-sm text-ink'
                        : 'rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-ink'
                    }
                  >
                    {row.status === 'approved'
                      ? `${UPDATE_REQUEST_LABELS[row.field]} now reads ${row.proposedValue}.`
                      : `${UPDATE_REQUEST_LABELS[row.field]} was not changed. ${row.adminNote ?? ''}`}
                  </p>
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
      </Card>

      <Card title="Change your password">
        <p className="mb-4 text-xs text-ink-subtle">
          Uses the same six-digit code as a reset, sent to your address.
        </p>
        <Link href="/reset" className={LINK_SECONDARY}>
          Change password
        </Link>
      </Card>
    </KitShell>
  );
}
