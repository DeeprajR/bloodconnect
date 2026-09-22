import type { Metadata } from 'next';
import Link from 'next/link';

import { Card, PageHeader, StatusBadge, linkButtonClasses } from '@blood-connect/ui';

import { CentreShell } from '../../centre-shell';
import { requireAccess, useCaseContext } from '@/lib/guards';
import { listBags } from '@blood-connect/centre';
import { DiscardBagForm } from '../../centre-collision-forms';
import {
  BLOOD_GROUPS,
  PRODUCTS,
  WORDING,
  bloodGroupLabel,
  daysUntilExpiry,
  parseCalendarDay,
  productLabel,
} from '@blood-connect/domain';

export const metadata: Metadata = { title: 'Register · Blood Connect' };

const STATUSES = [
  'available',
  'reserved',
  'issued',
  'returned',
  'quarantined',
  'discarded',
  'expired',
  'lost',
] as const;

const LINK_PRIMARY = linkButtonClasses({ variant: 'primary' });

const CONTROL =
  'h-10 w-full rounded-control border border-border-strong bg-surface px-3 ' +
  'text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAccess('/centre/stock');
  if (actor.kind !== 'user') return null;
  const ctx = await useCaseContext(actor);
  const query = await searchParams;

  const one = (key: string): string | undefined => {
    const raw = query[key];
    return typeof raw === 'string' && raw !== '' ? raw : undefined;
  };

  const filter = {
    bloodGroup: one('group'),
    product: one('product'),
    status: one('status') ?? 'available',
  };

  const bags = await listBags(ctx, filter);
  const today = ctx.clock.today();

  return (
    <CentreShell actor={actor} title="Register" currentPath="/centre/stock">
      <PageHeader
        title="The register"
        description="One row per physical bag, shortest-dated first, which is the order units are issued in."
        actions={
          <Link href="/centre/stock/new" className={LINK_PRIMARY}>
            Register a bag
          </Link>
        }
      />

      {one('flagged') ? (
        <p
          role="alert"
          className="rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-ink"
        >
          {/*
            The label won and the bag was registered. Flagged, not
            blocked (§4). The operator has the unit in their hand, the
            system does not.
          */}
          <span className="font-medium text-warning">Expiry mismatch.</span>{' '}
          That bag was registered with the expiry printed on its label, which
          did not match the date derived from its collection. Check the unit
          against the label.
        </p>
      ) : null}

      <Card>
        <form
          method="get"
          className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
        >
          <div className="space-y-1.5">
            <label htmlFor="group" className="block text-sm font-medium text-ink">
              Group
            </label>
            <select
              id="group"
              name="group"
              defaultValue={filter.bloodGroup ?? ''}
              className={CONTROL}
            >
              <option value="">All</option>
              {BLOOD_GROUPS.map((group) => (
                <option key={group} value={group}>
                  {bloodGroupLabel(group)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="product" className="block text-sm font-medium text-ink">
              {WORDING.product}
            </label>
            <select
              id="product"
              name="product"
              defaultValue={filter.product ?? ''}
              className={CONTROL}
            >
              <option value="">All</option>
              {PRODUCTS.map((product) => (
                <option key={product} value={product}>
                  {productLabel(product)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="status" className="block text-sm font-medium text-ink">
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={filter.status}
              className={CONTROL}
            >
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-control border border-border-strong bg-surface px-4 text-sm font-medium text-ink transition-colors hover:bg-surface-muted no-underline"
          >
            Filter
          </button>
        </form>

        {bags.length === 0 ? (
          <p className="rounded-card border border-dashed border-border-strong bg-surface p-8 text-center text-sm text-ink-muted">
            Nothing matches that filter.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-ink-subtle">
                  <th scope="col" className="px-4 py-2 text-left font-semibold">
                    {WORDING.unitNumber}
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-semibold">
                    Group
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-semibold">
                    {WORDING.product}
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-semibold">
                    {WORDING.collectedOn}
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-semibold">
                    {WORDING.expiresOn}
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">
                    Days left
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-semibold">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {bags.map((bag) => {
                  const expiry = parseCalendarDay(bag.expiresAt);
                  const left = expiry ? daysUntilExpiry(expiry, today) : null;
                  return (
                    <tr
                      key={bag.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-4 py-2.5 align-middle font-mono tabular-nums text-ink">
                        {bag.unitNumber}
                      </td>
                      <td className="px-4 py-2.5 align-middle font-medium tabular-nums text-ink">
                        {bloodGroupLabel(bag.bloodGroup as never)}
                      </td>
                      <td className="px-4 py-2.5 align-middle text-ink">
                        {productLabel(bag.product as never)}
                      </td>
                      <td className="px-4 py-2.5 align-middle tabular-nums text-ink">
                        {bag.collectedAt}
                      </td>
                      <td className="px-4 py-2.5 align-middle tabular-nums text-ink">
                        {bag.expiresAt}
                        {bag.expirySource === 'label' ? (
                          <span className="ml-1 text-xs font-normal text-ink-subtle">
                            (label)
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-right align-middle">
                        {left === null ? (
                          <span className="text-ink-muted">—</span>
                        ) : left < 0 ? (
                          <StatusBadge label="expired" tone="danger" />
                        ) : left <= 7 ? (
                          <StatusBadge label={String(left)} tone="danger" />
                        ) : (
                          <span className="tabular-nums text-ink">{left}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 align-middle text-ink">
                        {bag.status}
                      </td>
                      <td className="px-4 py-2.5 text-right align-middle">
                        {/*
                          Offered only where it is a legal move (§12.1).
                          A bag that is issued or already discarded gets
                          no button, rather than a button that fails.
                        */}
                        {bag.status === 'available' ||
                        bag.status === 'quarantined' ||
                        bag.status === 'returned' ||
                        bag.status === 'expired' ? (
                          <DiscardBagForm bagId={bag.id} />
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-xs text-ink-subtle">
          {/*
            A discard is not a status change, it is a physical event with
            a route (§12.1). Returns start at the tag, because that is
            where the unit is in somebody's hand.
          */}
          A returned unit is recorded by scanning its tag. A discard always
          asks where the unit physically went. The fridge camera that counts
          what is actually on the shelf arrives in a later phase.
        </p>
      </Card>

      <div>
        <Link
          href="/centre"
          className="text-sm font-medium text-ink-muted hover:text-ink hover:underline"
        >
          ← Back to the overview
        </Link>
      </div>
    </CentreShell>
  );
}
