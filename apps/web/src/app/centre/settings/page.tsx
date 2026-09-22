import type { Metadata } from 'next';
import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';

import { Card, PageHeader } from '@blood-connect/ui';

import { CentreShell } from '../../centre-shell';
import { SettingsForm, ShelfLifeForm } from '../../centre-forms';
import { requireAccess, useCaseContext } from '@/lib/guards';
import { getCentreSettings, getShelfLives } from '@blood-connect/centre';
import { locationNodes } from '@blood-connect/db';
import { WORDING, productLabel } from '@blood-connect/domain';

export const metadata: Metadata = { title: 'Centre settings · Blood Connect' };

export default async function SettingsPage() {
  const actor = await requireAccess('/centre/settings');
  if (actor.kind !== 'user') return null;
  const ctx = await useCaseContext(actor);

  const [settings, shelfLives, districts] = await Promise.all([
    getCentreSettings(ctx),
    getShelfLives(ctx),
    // The shared `reference` hierarchy, readable by both modules by
    // design (§5.8). This is not another module's table.
    ctx.db
      .select({ id: locationNodes.id, name: locationNodes.name })
      .from(locationNodes)
      .where(eq(locationNodes.level, 'district'))
      .orderBy(asc(locationNodes.name)),
  ]);

  return (
    <CentreShell
      actor={actor}
      title="Centre settings"
      currentPath="/centre/settings"
    >
      <PageHeader
        title="Settings"
        description="What donors are told, and the numbers the register runs on."
      />

      <Card title="Identity and the stock floor">
        <SettingsForm
          hospitalName={settings?.hospitalName ?? ''}
          address={settings?.address ?? ''}
          districtId={settings?.districtId ?? null}
          cityId={settings?.cityId ?? null}
          minUnitsPerGroup={settings?.minUnitsPerGroup ?? 25}
          returnTimeLimitMinutes={settings?.returnTimeLimitMinutes ?? 30}
          districts={districts}
        />
      </Card>

      <Card title="Shelf life per component">
        <p className="mb-4 text-xs text-ink-subtle">
          {/*
            Configuration, not constants (§12). And it applies to bags
            registered from here on: a stored expiry belongs to that
            donation, not to today's configuration.
          */}
          In whole days from collection. A change applies to bags
          registered from now on; units already on the shelf keep the
          expiry they were registered with.
        </p>
        <div className="space-y-3">
          {shelfLives.map((row) => (
            <div
              key={row.product}
              className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="text-sm font-medium text-ink">
                {productLabel(row.product as never)}
              </span>
              <ShelfLifeForm product={row.product} days={row.shelfLifeDays} />
            </div>
          ))}
        </div>
      </Card>

      <p className="text-xs text-ink-subtle">
        Every change here is recorded in the audit log with who made it.
        The {WORDING.stockFloor.toLowerCase()} and the shelf lives decide
        when units stop being issuable and when donors are asked to come
        in.
      </p>

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
