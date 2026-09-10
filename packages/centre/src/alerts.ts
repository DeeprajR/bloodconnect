/**
 * What the centre knows is going wrong (§4, §11.9).
 *
 * The shelf and the tag register. Both of these are already visible on the
 * centre's own screens, and they are here because §11.9's board answers a
 * different question: not "what should the counter do next", but "is anything
 * in this system waiting on a person who does not know it".
 *
 * A quarantine past its expiry and a tag discrepancy nobody closed are the two
 * that go quiet. Neither blocks a screen, so neither is noticed until somebody
 * reaches for a unit that is not there.
 */

import { and, count, eq, isNull, lt, min } from 'drizzle-orm';
import { bagQuarantines, tagDiscrepancies } from '@blood-connect/db';
import type { Alert } from '@blood-connect/domain';
import type { UseCaseContext } from '@blood-connect/platform';

const ageSeconds = (from: Date | null, now: Date): number | null =>
  from === null ? null : Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));

export async function centreAlerts(ctx: UseCaseContext): Promise<readonly Alert[]> {
  const now = ctx.clock.now();

  // The same threshold the quarantine screen ages against (§12), read from
  // configuration rather than repeated, so the board and the screen cannot
  // disagree about when something is late.
  const overdueBefore = new Date(
    now.getTime() - ctx.config.ageing.quarantineDays * 86_400_000,
  );
  const reconcileBefore = new Date(
    now.getTime() - ctx.config.ageing.reconciliationHours * 3_600_000,
  );

  const [quarantine] = await ctx.db
    .select({ n: count(), oldest: min(bagQuarantines.openedAt) })
    .from(bagQuarantines)
    .where(and(isNull(bagQuarantines.resolvedAt), lt(bagQuarantines.openedAt, overdueBefore)));

  const quarantineIds = await ctx.db
    .select({ bagId: bagQuarantines.bagId })
    .from(bagQuarantines)
    .where(and(isNull(bagQuarantines.resolvedAt), lt(bagQuarantines.openedAt, overdueBefore)))
    .limit(5);

  const [discrepancy] = await ctx.db
    .select({ n: count(), oldest: min(tagDiscrepancies.presentedAt) })
    .from(tagDiscrepancies)
    .where(
      and(eq(tagDiscrepancies.status, 'open'), lt(tagDiscrepancies.presentedAt, reconcileBefore)),
    );

  const discrepancyIds = await ctx.db
    .select({ id: tagDiscrepancies.id })
    .from(tagDiscrepancies)
    .where(
      and(eq(tagDiscrepancies.status, 'open'), lt(tagDiscrepancies.presentedAt, reconcileBefore)),
    )
    .limit(5);

  return [
    {
      kind: 'centre.quarantine_overdue',
      level: 'critical',
      title: 'Quarantined units past their hold',
      // §4: a quarantine is a waiting room, not a destination. Past expiry the
      // unit is discarded automatically, so a row here means the discard is
      // about to happen without anybody having looked at the bag.
      whatToDo:
        'Resolve each one on the quarantine screen. Past the hold they are discarded automatically, and a discard nobody looked at is a unit written off blind.',
      count: quarantine?.n ?? 0,
      oldestAgeSeconds: ageSeconds(quarantine?.oldest ?? null, now),
      sample: quarantineIds.map((row) => row.bagId),
      href: '/centre/quarantine',
      app: 'staff',
    },
    {
      kind: 'centre.discrepancy_open',
      level: 'warning',
      title: 'Tag discrepancies nobody has closed',
      whatToDo:
        'Somebody has to physically look at the shelf and record what they found. Until then the register and the shelf disagree.',
      count: discrepancy?.n ?? 0,
      oldestAgeSeconds: ageSeconds(discrepancy?.oldest ?? null, now),
      sample: discrepancyIds.map((row) => row.id),
      href: '/centre/tags',
      app: 'staff',
    },
  ];
}
