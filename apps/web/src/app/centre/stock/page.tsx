import type { Metadata } from 'next';
import Link from 'next/link';

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

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAccess('/centre/stock');
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
    <CentreShell actor={actor} title="Register">
      <div className="app-row-split">
        <div className="app-stack-tight">
          <h1 className="ux4g-heading-l-strong">The register</h1>
          <p className="ux4g-body-m-default">
            One row per physical bag, shortest-dated first, which is the order units
            are issued in.
          </p>
        </div>
        <Link
          className="ux4g-btn ux4g-btn-primary ux4g-btn-md app-target"
          href="/centre/stock/new"
        >
          Register a bag
        </Link>
      </div>

      {one('flagged') ? (
        <div className="ux4g-alert ux4g-alert-warning" role="alert">
          <div className="ux4g-alert-content">
            <p className="ux4g-alert-message">
              {/*
                The label won and the bag was registered. Flagged, not blocked
                (§4). The operator has the unit in their hand, the system does
                not.
              */}
              That bag was registered with the expiry printed on its label, which
              did not match the date derived from its collection. Check the unit
              against the label.
            </p>
          </div>
        </div>
      ) : null}

      <section className="ux4g-card ux4g-card-outline">
        <div className="ux4g-card-header">
          <form className="app-row" method="get">
            <div className="ux4g-form-group app-stack-tight">
              <label className="ux4g-label-m-strong" htmlFor="group">
                Group
              </label>
              <select
                className="ux4g-form-select ux4g-form-select-md"
                id="group"
                name="group"
                defaultValue={filter.bloodGroup ?? ''}
              >
                <option value="">All</option>
                {BLOOD_GROUPS.map((group) => (
                  <option key={group} value={group}>
                    {bloodGroupLabel(group)}
                  </option>
                ))}
              </select>
            </div>

            <div className="ux4g-form-group app-stack-tight">
              <label className="ux4g-label-m-strong" htmlFor="product">
                {WORDING.product}
              </label>
              <select
                className="ux4g-form-select ux4g-form-select-md"
                id="product"
                name="product"
                defaultValue={filter.product ?? ''}
              >
                <option value="">All</option>
                {PRODUCTS.map((product) => (
                  <option key={product} value={product}>
                    {productLabel(product)}
                  </option>
                ))}
              </select>
            </div>

            <div className="ux4g-form-group app-stack-tight">
              <label className="ux4g-label-m-strong" htmlFor="status">
                Status
              </label>
              <select
                className="ux4g-form-select ux4g-form-select-md"
                id="status"
                name="status"
                defaultValue={filter.status}
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
              className="ux4g-btn ux4g-btn-outline-primary ux4g-btn-md app-target"
            >
              Filter
            </button>
          </form>
        </div>

        <div className="ux4g-card-body app-scroll-x">
          {bags.length === 0 ? (
            <p className="ux4g-body-s-default">Nothing matches that filter.</p>
          ) : (
            <table className="ux4g-table">
              <thead>
                <tr>
                  <th scope="col">{WORDING.unitNumber}</th>
                  <th scope="col">Group</th>
                  <th scope="col">{WORDING.product}</th>
                  <th scope="col">{WORDING.collectedOn}</th>
                  <th scope="col">{WORDING.expiresOn}</th>
                  <th scope="col">Days left</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="app-sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {bags.map((bag) => {
                  const expiry = parseCalendarDay(bag.expiresAt);
                  const left = expiry ? daysUntilExpiry(expiry, today) : null;
                  return (
                    <tr key={bag.id}>
                      <td className="app-figure">{bag.unitNumber}</td>
                      <td className="app-figure">
                        {bloodGroupLabel(bag.bloodGroup as never)}
                      </td>
                      <td>{productLabel(bag.product as never)}</td>
                      <td className="app-figure">{bag.collectedAt}</td>
                      <td className="app-figure">
                        {bag.expiresAt}
                        {bag.expirySource === 'label' ? (
                          <span className="ux4g-label-m-default"> (label)</span>
                        ) : null}
                      </td>
                      <td className="app-figure">
                        {left === null ? (
                          '-'
                        ) : left < 0 ? (
                          <span className="ux4g-badge-digit-danger">expired</span>
                        ) : left <= 7 ? (
                          <span className="ux4g-badge-digit-danger">{left}</span>
                        ) : (
                          left
                        )}
                      </td>
                      <td>{bag.status}</td>
                      <td>
                        {/*
                          Offered only where it is a legal move (§12.1). A bag
                          that is issued or already discarded gets no button,
                          rather than a button that fails.
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
          )}
        </div>
        <div className="ux4g-card-footer">
          <p className="ux4g-label-m-default">
            {/*
              A discard is not a status change, it is a physical event with a
              route (§12.1). Returns start at the tag, because that is where the
              unit is in somebody's hand.
            */}
            A returned unit is recorded by scanning its tag. A discard always asks where
            the unit physically went. The fridge camera that counts what is actually on
            the shelf arrives in a later phase.
          </p>
        </div>
      </section>

      <Link className="ux4g-btn ux4g-btn-text-neutral ux4g-btn-md" href="/centre">
        Back to the overview
      </Link>
    </CentreShell>
  );
}
