/**
 * Module 2's reads.
 *
 * Nothing here writes, and nothing here reads a Module 1 table: the queue and
 * the decision come through `@blood-connect/hospital`'s narrow API (§11.2).
 */

import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  bloodBags,
  centreDecisions,
  centreSettings,
  decisionBags,
  donorDemand,
  productShelfLives,
} from '@blood-connect/db';
import {
  BLOOD_GROUPS,
  PRODUCTS,
  daysUntilExpiry,
  parseCalendarDay,
  recruitsDonors,
  type BloodGroup,
  type Product,
} from '@blood-connect/domain';
import type { UseCaseContext } from '@blood-connect/platform';

export type GroupStock = {
  readonly bloodGroup: BloodGroup;
  /** Red cells only — see `stockByGroup`. */
  readonly onShelf: number;
  readonly reserved: number;
  readonly floor: number;
  readonly short: number;
  /** Units expiring within a week, so a counter can move them first. */
  readonly expiringSoon: number;
};

/**
 * Stock per group against the floor (§4).
 *
 * **The floor counts red cells only** — whole blood and packed cells. That is a
 * decision worth stating: a floor met by bags of plasma would read as
 * comfortable while there was nothing on the shelf a walk-in donor could
 * replace, and "recruit for groups below floor" would then raise a demand
 * nobody can fill. The register screen shows every product; this comparison
 * uses the ones recruitment can actually answer.
 */
export async function stockByGroup(ctx: UseCaseContext): Promise<GroupStock[]> {
  const redCells = PRODUCTS.filter(recruitsDonors);
  const soon = 7;

  const [settings] = await ctx.db
    .select({ floor: centreSettings.minUnitsPerGroup })
    .from(centreSettings)
    .where(eq(centreSettings.id, 1));
  const floor = settings?.floor ?? 25;

  const rows = await ctx.db
    .select({
      bloodGroup: bloodBags.bloodGroup,
      status: bloodBags.status,
      expiresAt: bloodBags.expiresAt,
    })
    .from(bloodBags)
    .where(
      and(
        inArray(bloodBags.product, redCells as unknown as string[]),
        inArray(bloodBags.status, ['available', 'reserved']),
      ),
    );

  const today = ctx.clock.today();

  return BLOOD_GROUPS.map((bloodGroup) => {
    const mine = rows.filter((row) => row.bloodGroup === bloodGroup);
    // A reserved bag is held for a decision somebody has been told about, so it
    // counts as unavailable for anything else and is excluded from the floor
    // (§4). Counting it would recruit fewer donors than the shelf needs.
    const onShelf = mine.filter((row) => row.status === 'available').length;
    const reserved = mine.filter((row) => row.status === 'reserved').length;
    const expiringSoon = mine.filter((row) => {
      if (row.status !== 'available') return false;
      // `date` columns come back as strings; the branded type is what keeps the
      // day arithmetic from being handed an instant by accident.
      const expiry = parseCalendarDay(row.expiresAt);
      if (!expiry) return false;
      const left = daysUntilExpiry(expiry, today);
      return left >= 0 && left <= soon;
    }).length;

    return {
      bloodGroup,
      onShelf,
      reserved,
      floor,
      short: Math.max(0, floor - onShelf),
      expiringSoon,
    };
  });
}

/** Stock on hand for one group and product — what the decision screen shows. */
export async function availableUnits(
  ctx: UseCaseContext,
  bloodGroup: BloodGroup,
  product: Product,
): Promise<number> {
  const [row] = await ctx.db
    .select({ n: count() })
    .from(bloodBags)
    .where(
      and(
        eq(bloodBags.bloodGroup, bloodGroup),
        eq(bloodBags.product, product),
        eq(bloodBags.status, 'available'),
      ),
    );

  return row?.n ?? 0;
}

export type BagRow = {
  readonly id: string;
  readonly unitNumber: string;
  readonly bloodGroup: string;
  readonly product: string;
  readonly collectedAt: string;
  readonly expiresAt: string;
  readonly expirySource: string;
  readonly status: string;
  readonly source: string | null;
};

export type BagFilter = {
  readonly bloodGroup?: string | undefined;
  readonly product?: string | undefined;
  readonly status?: string | undefined;
};

/** The register, filtered. Shortest-dated first: that is the order it is used in. */
export async function listBags(
  ctx: UseCaseContext,
  filter: BagFilter = {},
  limit = 200,
): Promise<BagRow[]> {
  const conditions = [];
  if (filter.bloodGroup) conditions.push(eq(bloodBags.bloodGroup, filter.bloodGroup));
  if (filter.product) conditions.push(eq(bloodBags.product, filter.product));
  if (filter.status) conditions.push(eq(bloodBags.status, filter.status));

  return ctx.db
    .select({
      id: bloodBags.id,
      unitNumber: bloodBags.unitNumber,
      bloodGroup: bloodBags.bloodGroup,
      product: bloodBags.product,
      collectedAt: bloodBags.collectedAt,
      expiresAt: bloodBags.expiresAt,
      expirySource: bloodBags.expirySource,
      status: bloodBags.status,
      source: bloodBags.source,
    })
    .from(bloodBags)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(bloodBags.expiresAt), asc(bloodBags.unitNumber))
    .limit(limit);
}

export type DecisionRow = {
  readonly id: string;
  readonly requestId: string;
  readonly decision: string;
  readonly unitsIssued: number;
  readonly unitsRequested: number;
  readonly note: string | null;
  readonly decidedAt: Date;
  readonly demandId: string | null;
};

export async function getDecisionForRequest(
  ctx: UseCaseContext,
  requestUuid: string,
): Promise<DecisionRow | undefined> {
  const [row] = await ctx.db
    .select({
      id: centreDecisions.id,
      requestId: centreDecisions.requestId,
      decision: centreDecisions.decision,
      unitsIssued: centreDecisions.unitsIssued,
      unitsRequested: centreDecisions.unitsRequested,
      note: centreDecisions.note,
      decidedAt: centreDecisions.decidedAt,
      demandId: centreDecisions.demandId,
    })
    .from(centreDecisions)
    .where(eq(centreDecisions.requestId, requestUuid));

  return row;
}

/** The units issued against a decision, by unit number — the traceability read. */
export async function listDecisionBags(
  ctx: UseCaseContext,
  decisionId: string,
): Promise<{ id: string; unitNumber: string; expiresAt: string; status: string }[]> {
  return ctx.db
    .select({
      id: bloodBags.id,
      unitNumber: bloodBags.unitNumber,
      expiresAt: bloodBags.expiresAt,
      status: bloodBags.status,
    })
    .from(decisionBags)
    .innerJoin(bloodBags, eq(bloodBags.id, decisionBags.bagId))
    .where(eq(decisionBags.decisionId, decisionId))
    .orderBy(asc(bloodBags.expiresAt));
}

export type DemandRow = {
  readonly id: string;
  readonly trigger: string;
  readonly bloodGroup: string;
  readonly product: string;
  readonly units: number;
  readonly dateRequired: string;
  readonly status: string;
  readonly botPublicId: string | null;
  readonly donorsNotified: number;
  readonly confirmedUnits: number;
  readonly waitlistedUnits: number;
  readonly completedUnits: number;
  readonly notes: string | null;
  readonly createdAt: Date;
};

export async function listDemands(
  ctx: UseCaseContext,
  onlyOpen = false,
  limit = 100,
): Promise<DemandRow[]> {
  return ctx.db
    .select({
      id: donorDemand.id,
      trigger: donorDemand.trigger,
      bloodGroup: donorDemand.bloodGroup,
      product: donorDemand.product,
      units: donorDemand.units,
      dateRequired: donorDemand.dateRequired,
      status: donorDemand.status,
      botPublicId: donorDemand.botPublicId,
      donorsNotified: donorDemand.donorsNotified,
      confirmedUnits: donorDemand.confirmedUnits,
      waitlistedUnits: donorDemand.waitlistedUnits,
      completedUnits: donorDemand.completedUnits,
      notes: donorDemand.notes,
      createdAt: donorDemand.createdAt,
    })
    .from(donorDemand)
    .where(onlyOpen ? eq(donorDemand.status, 'open') : undefined)
    .orderBy(desc(donorDemand.createdAt))
    .limit(limit);
}

/** One demand, for the roster page. */
export async function getDemand(
  ctx: UseCaseContext,
  demandId: string,
): Promise<DemandRow | undefined> {
  const [row] = await ctx.db
    .select({
      id: donorDemand.id,
      trigger: donorDemand.trigger,
      bloodGroup: donorDemand.bloodGroup,
      product: donorDemand.product,
      units: donorDemand.units,
      dateRequired: donorDemand.dateRequired,
      status: donorDemand.status,
      botPublicId: donorDemand.botPublicId,
      donorsNotified: donorDemand.donorsNotified,
      confirmedUnits: donorDemand.confirmedUnits,
      waitlistedUnits: donorDemand.waitlistedUnits,
      completedUnits: donorDemand.completedUnits,
      notes: donorDemand.notes,
      createdAt: donorDemand.createdAt,
    })
    .from(donorDemand)
    .where(eq(donorDemand.id, demandId));

  return row;
}

export type CentreSettingsRow = {
  readonly hospitalName: string;
  readonly address: string;
  readonly districtId: string | null;
  readonly cityId: string | null;
  readonly minUnitsPerGroup: number;
  readonly returnTimeLimitMinutes: number;
};

export async function getCentreSettings(
  ctx: UseCaseContext,
): Promise<CentreSettingsRow | undefined> {
  const [row] = await ctx.db
    .select({
      hospitalName: centreSettings.hospitalName,
      address: centreSettings.address,
      districtId: centreSettings.districtId,
      cityId: centreSettings.cityId,
      minUnitsPerGroup: centreSettings.minUnitsPerGroup,
      returnTimeLimitMinutes: centreSettings.returnTimeLimitMinutes,
    })
    .from(centreSettings)
    .where(eq(centreSettings.id, 1));

  return row;
}

export async function getShelfLives(
  ctx: UseCaseContext,
): Promise<{ product: string; shelfLifeDays: number }[]> {
  return ctx.db
    .select({
      product: productShelfLives.product,
      shelfLifeDays: productShelfLives.shelfLifeDays,
    })
    .from(productShelfLives)
    .orderBy(asc(productShelfLives.product));
}

/** Counts for the overview, in one round trip rather than four. */
export async function centreOverviewCounts(
  ctx: UseCaseContext,
): Promise<{ openDemands: number; awaitingImport: number; reservedBags: number }> {
  const [demands] = await ctx.db
    .select({
      open: count(),
      // Cast to int4: an uncast count() is a bigint, which the driver hands
      // back as a string, and "3" > 0 is a comparison that quietly always holds.
      awaiting: sql<number>`count(*) FILTER (WHERE ${donorDemand.botPublicId} IS NULL)::int`,
    })
    .from(donorDemand)
    .where(eq(donorDemand.status, 'open'));

  const [reserved] = await ctx.db
    .select({ n: count() })
    .from(bloodBags)
    .where(eq(bloodBags.status, 'reserved'));

  return {
    openDemands: demands?.open ?? 0,
    awaitingImport: demands?.awaiting ?? 0,
    reservedBags: reserved?.n ?? 0,
  };
}
