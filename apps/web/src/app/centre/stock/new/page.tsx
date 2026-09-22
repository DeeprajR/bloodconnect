import type { Metadata } from 'next';
import Link from 'next/link';

import { Card, PageHeader } from '@blood-connect/ui';

import { CentreShell } from '../../../centre-shell';
import { BagForm } from '../../../centre-forms';
import { requireAccess, useCaseContext } from '@/lib/guards';
import { getShelfLives } from '@blood-connect/centre';

export const metadata: Metadata = { title: 'Register a bag · Blood Connect' };

export default async function NewBagPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAccess('/centre/stock/new');
  if (actor.kind !== 'user') return null;
  const ctx = await useCaseContext(actor);
  const query = await searchParams;

  // Arriving from a scan of a free tag: the tag is already in hand, so
  // it is filled in rather than typed a second time.
  const raw = query['tag'];
  const tagUid = typeof raw === 'string' ? raw.trim() : '';

  const shelfLives = await getShelfLives(ctx);
  const byProduct = Object.fromEntries(
    shelfLives.map((row) => [row.product, row.shelfLifeDays]),
  );

  return (
    <CentreShell
      actor={actor}
      title="Register a bag"
      currentPath="/centre/stock/new"
    >
      <PageHeader
        title="Register a bag"
        description={
          // §10 requires the typed path regardless of hardware, so it is
          // the path that was built. A scanner presents as a keyboard and
          // fills the same fields when one arrives.
          'Type the unit number, or read it with a scanner. The expiry is worked out from the collection date and the shelf life, and shown before you save.'
        }
      />

      <Card>
        <BagForm
          today={ctx.clock.today()}
          shelfLives={byProduct}
          tagUid={tagUid}
        />
      </Card>

      <div>
        <Link
          href="/centre/stock"
          className="text-sm font-medium text-ink-muted hover:text-ink hover:underline"
        >
          ← Back to the register
        </Link>
      </div>
    </CentreShell>
  );
}
