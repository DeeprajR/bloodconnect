import type { Metadata } from 'next';
import Link from 'next/link';

import { AppShell } from '../../../shell';
import { BagForm } from '../../../centre-forms';
import { requireAccess, useCaseContext } from '@/lib/guards';
import { getShelfLives } from '@blood-connect/centre';

export const metadata: Metadata = { title: 'Register a bag · Blood Connect' };

export default async function NewBagPage() {
  const actor = await requireAccess('/centre/stock/new');
  const ctx = await useCaseContext(actor);

  const shelfLives = await getShelfLives(ctx);
  const byProduct = Object.fromEntries(
    shelfLives.map((row) => [row.product, row.shelfLifeDays]),
  );

  return (
    <AppShell actor={actor} title="Register a bag" narrow>
      <div className="app-stack-tight">
        <h1 className="ux4g-heading-l-strong">Register a bag</h1>
        <p className="ux4g-body-m-default">
          {/*
            §10 requires the typed path regardless of hardware, so it is the path
            that was built — a scanner presents as a keyboard and fills the same
            fields when one arrives.
          */}
          Type the unit number, or read it with a scanner. The expiry is worked out
          from the collection date and the shelf life, and shown before you save.
        </p>
      </div>

      <section className="ux4g-card ux4g-card-outline">
        <div className="ux4g-card-body">
          <BagForm today={ctx.clock.today()} shelfLives={byProduct} />
        </div>
      </section>

      <Link className="ux4g-btn ux4g-btn-text-neutral ux4g-btn-md" href="/centre/stock">
        Back to the register
      </Link>
    </AppShell>
  );
}
