import type { Metadata } from 'next';
import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';

import { AppShell } from '../../shell';
import { SettingsForm, ShelfLifeForm } from '../../centre-forms';
import { requireAccess, useCaseContext } from '@/lib/guards';
import { getCentreSettings, getShelfLives } from '@blood-connect/centre';
import { locationNodes } from '@blood-connect/db';
import { WORDING, productLabel } from '@blood-connect/domain';

export const metadata: Metadata = { title: 'Centre settings · Blood Connect' };

export default async function SettingsPage() {
  const actor = await requireAccess('/centre/settings');
  const ctx = await useCaseContext(actor);

  const [settings, shelfLives, districts] = await Promise.all([
    getCentreSettings(ctx),
    getShelfLives(ctx),
    // The shared `reference` hierarchy, readable by both modules by design
    // (§5.8) — this is not another module's table.
    ctx.db
      .select({ id: locationNodes.id, name: locationNodes.name })
      .from(locationNodes)
      .where(eq(locationNodes.level, 'district'))
      .orderBy(asc(locationNodes.name)),
  ]);

  return (
    <AppShell actor={actor} title="Centre settings" narrow>
      <div className="app-stack-tight">
        <h1 className="ux4g-heading-l-strong">Settings</h1>
        <p className="ux4g-body-m-default">
          What donors are told, and the numbers the register runs on.
        </p>
      </div>

      <section className="ux4g-card ux4g-card-outline">
        <div className="ux4g-card-header">
          <h2 className="ux4g-card-title">Identity and the stock floor</h2>
        </div>
        <div className="ux4g-card-body">
          <SettingsForm
            hospitalName={settings?.hospitalName ?? ''}
            address={settings?.address ?? ''}
            districtId={settings?.districtId ?? null}
            cityId={settings?.cityId ?? null}
            minUnitsPerGroup={settings?.minUnitsPerGroup ?? 25}
            returnTimeLimitMinutes={settings?.returnTimeLimitMinutes ?? 30}
            districts={districts}
          />
        </div>
      </section>

      <section className="ux4g-card ux4g-card-outline">
        <div className="ux4g-card-header">
          <h2 className="ux4g-card-title">Shelf life per component</h2>
          <p className="ux4g-card-sub-title">
            {/*
              Configuration, not constants (§12). And it applies to bags
              registered from here on: a stored expiry belongs to that donation,
              not to today's configuration.
            */}
            In whole days from collection. A change applies to bags registered from
            now on; units already on the shelf keep the expiry they were registered
            with.
          </p>
        </div>
        <div className="ux4g-card-body app-stack">
          {shelfLives.map((row) => (
            <div key={row.product} className="app-row-split">
              <span className="ux4g-label-l-strong">
                {productLabel(row.product as never)}
              </span>
              <ShelfLifeForm product={row.product} days={row.shelfLifeDays} />
            </div>
          ))}
        </div>
      </section>

      <p className="ux4g-label-m-default">
        Every change here is recorded in the audit log with who made it. The{' '}
        {WORDING.stockFloor.toLowerCase()} and the shelf lives decide when units stop
        being issuable and when donors are asked to come in.
      </p>

      <Link className="ux4g-btn ux4g-btn-text-neutral ux4g-btn-md" href="/centre">
        Back to the overview
      </Link>
    </AppShell>
  );
}
