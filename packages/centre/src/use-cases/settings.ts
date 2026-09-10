/**
 * Centre settings and the shelf-life table (§4, §12).
 *
 * Everything here is snapshotted onto new demands and never applied
 * retroactively (§2.6). Correcting the address changes what the next donor is
 * told; it does not change what the last one was told, because they may already
 * have set out.
 *
 * The shelf lives sit here rather than in `app_config` for the reason
 * `packages/config` states: `app_config` holds what has no screen, and these
 * have one.
 */

import { eq } from 'drizzle-orm';
import { err, ok, type Result } from '@blood-connect/result';
import { centreSettings, productShelfLives } from '@blood-connect/db';
import { isProduct, type Product } from '@blood-connect/domain';
import { actorHas, createAuditWriter, type UseCaseContext } from '@blood-connect/platform';

import { invalidBag, notAuthorized, type InvalidBag, type NotAuthorized } from '../errors.js';

export type SettingsInput = {
  readonly hospitalName: string;
  readonly address: string;
  readonly districtId: string | null;
  readonly cityId: string | null;
  readonly minUnitsPerGroup: number;
  readonly returnTimeLimitMinutes: number;
};

export async function updateCentreSettings(
  ctx: UseCaseContext,
  input: SettingsInput,
): Promise<Result<Record<string, never>, NotAuthorized | InvalidBag>> {
  if (!actorHas(ctx.actor, 'centre:configure')) return err(notAuthorized('centre:configure'));

  if (input.hospitalName.trim().length === 0) {
    return err(invalidBag('Enter the hospital name. Donors are shown this.'));
  }
  if (input.address.trim().length === 0) {
    return err(invalidBag('Enter the address. Donors are told to come here.'));
  }
  if (!Number.isInteger(input.minUnitsPerGroup) || input.minUnitsPerGroup < 0) {
    return err(invalidBag('The stock floor must be a whole number of units.'));
  }
  if (!Number.isInteger(input.returnTimeLimitMinutes) || input.returnTimeLimitMinutes < 0) {
    return err(invalidBag('The return time limit must be a whole number of minutes.'));
  }

  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    await tx
      .update(centreSettings)
      .set({
        hospitalName: input.hospitalName.trim(),
        address: input.address.trim(),
        districtId: input.districtId,
        cityId: input.cityId,
        minUnitsPerGroup: input.minUnitsPerGroup,
        returnTimeLimitMinutes: input.returnTimeLimitMinutes,
        updatedBy: ctx.actor.kind === 'user' ? ctx.actor.userId : null,
      })
      .where(eq(centreSettings.id, 1));

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'centre.settings_updated',
      subjectType: 'centre_settings',
      subjectId: '1',
      metadata: {
        hospitalName: input.hospitalName.trim(),
        districtId: input.districtId,
        minUnitsPerGroup: input.minUnitsPerGroup,
        returnTimeLimitMinutes: input.returnTimeLimitMinutes,
      },
    });

    return ok({});
  });
}

/**
 * Changes one product's shelf life.
 *
 * Audited by product and value, because this figure decides when a unit stops
 * being issuable, and "who shortened the platelet shelf life, and when" is a
 * question somebody will eventually have to answer.
 *
 * It applies to bags registered from here on. Existing bags keep the expiry
 * they were registered with, which is the same rule as everywhere else: a
 * stored expiry is a property of that donation, not of today's configuration.
 */
export async function setShelfLife(
  ctx: UseCaseContext,
  product: string,
  days: number,
): Promise<Result<Record<string, never>, NotAuthorized | InvalidBag>> {
  if (!actorHas(ctx.actor, 'centre:configure')) return err(notAuthorized('centre:configure'));
  if (!isProduct(product)) return err(invalidBag('Unknown product.'));
  if (!Number.isInteger(days) || days < 1) {
    return err(invalidBag('The shelf life must be at least one day.'));
  }

  const now = ctx.clock.now();
  const typed: Product = product;

  return ctx.db.transaction(async (tx) => {
    await tx
      .update(productShelfLives)
      .set({ shelfLifeDays: days, updatedBy: ctx.actor.kind === 'user' ? ctx.actor.userId : null })
      .where(eq(productShelfLives.product, typed));

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'centre.shelf_life_updated',
      subjectType: 'product_shelf_life',
      subjectId: typed,
      metadata: { product: typed, shelfLifeDays: days },
    });

    return ok({});
  });
}
