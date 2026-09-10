/**
 * Module 4's reads (§6).
 *
 * The whole module. §6 says the volunteer dashboard owns no data, and this is
 * what that means in practice: two shared tables from §7, plus the reference
 * hierarchy for a town name, and nothing else. There is no write anywhere in
 * this package.
 *
 * **It cannot see a person.** Not "does not". Cannot. No query here touches a
 * patient, a request, a doctor or a donor row, so there is no code path by
 * which a name or a phone number could reach this surface even if a component
 * asked for one. `boundary.test.ts` next to this file fails the build if a
 * table name from any of those appears in this directory.
 *
 * The shelf is read the same way: a group under its floor is a group the centre
 * has raised a `stock_floor` demand for (§4). That keeps the signal inside the
 * contract of §7 rather than reaching into the centre's inventory, and it is
 * also the more honest number. It says the centre has decided to recruit, not
 * that a volunteer inferred it from a count they cannot see.
 */

import { and, eq, gte, sql } from 'drizzle-orm';
import { donorDemand, locationNodes } from '@blood-connect/db';
import {
  BLOOD_GROUPS,
  STOCK_DISPLAY_ORDER,
  pressureFor,
  unitsOutstanding,
  type BloodGroup,
  type PressureLevel,
} from '@blood-connect/domain';
import type { UseCaseContext } from '@blood-connect/platform';

/**
 * How much of the board a volunteer sees.
 *
 * `null` means the whole state, which is what the public board and an unscoped
 * volunteer admin both get. §6 asks for scoping that matches the chat
 * whitelist, and `donor_demand.district_id` is the same identifier that
 * whitelist uses.
 */
export type Scope = { readonly districtId: string | null };

export const UNSCOPED: Scope = { districtId: null };

export type GroupPressure = {
  readonly bloodGroup: BloodGroup;
  readonly level: PressureLevel;
  /** Units asked for across every open demand for the group. */
  readonly unitsRequired: number;
  readonly unitsConfirmed: number;
  readonly unitsOutstanding: number;
  /** Donors the bot has messaged. Shown so "nobody yet" is legible as effort. */
  readonly donorsNotified: number;
  readonly openDemands: number;
  /** The centre has an open `stock_floor` demand for this group (§4). */
  readonly belowFloor: boolean;
};

export type DemandLine = {
  readonly id: string;
  readonly bloodGroup: BloodGroup;
  readonly hospitalName: string;
  readonly town: string | null;
  readonly unitsRequired: number;
  readonly unitsConfirmed: number;
  readonly unitsOutstanding: number;
  readonly donorsNotified: number;
  /** `YYYY-MM-DD`, as stored. Formatting is the surface's business. */
  readonly neededBy: string;
  readonly forStockFloor: boolean;
};

/**
 * One row of the public board (§9.4).
 *
 * Deliberately narrower than `DemandLine`: no counts of who was notified or who
 * confirmed, because those are the recruitment effort and not the need. The
 * shape is pinned by a test that fails if a field is added, so a column cannot
 * arrive here by being convenient somewhere else (§14).
 */
export type PublicDemandRow = {
  readonly bloodGroup: BloodGroup;
  readonly hospitalName: string;
  readonly town: string | null;
  readonly unitsOutstanding: number;
  readonly neededBy: string;
};

export type TrendPoint = {
  /** Monday of the week, `YYYY-MM-DD`. */
  readonly weekStart: string;
  readonly unitsRequired: number;
  readonly unitsMet: number;
};

/* -------------------------------------------------------------------------- */

const scopeClause = (scope: Scope) =>
  scope.districtId === null ? undefined : eq(donorDemand.districtId, scope.districtId);

/** Open demand, scoped, with the town joined in. Everything below starts here. */
function openDemand(ctx: UseCaseContext, scope: Scope) {
  return ctx.db
    .select({
      id: donorDemand.id,
      bloodGroup: donorDemand.bloodGroup,
      hospitalName: donorDemand.hospitalName,
      town: locationNodes.name,
      units: donorDemand.units,
      confirmedUnits: donorDemand.confirmedUnits,
      donorsNotified: donorDemand.donorsNotified,
      dateRequired: donorDemand.dateRequired,
      trigger: donorDemand.trigger,
    })
    .from(donorDemand)
    // Left, not inner: a `stock_floor` demand has no city, and an inner join
    // would silently drop exactly the demands that mean the shelf is empty.
    .leftJoin(locationNodes, eq(locationNodes.id, donorDemand.cityId))
    .where(and(eq(donorDemand.status, 'open'), scopeClause(scope)));
}

/**
 * The eight tiles (§6).
 *
 * Always eight rows, in the clinical reading order, including the groups with
 * nothing outstanding. A dashboard that hides the quiet groups makes a
 * volunteer wonder whether a group is covered or merely missing.
 */
export async function groupPressure(
  ctx: UseCaseContext,
  scope: Scope = UNSCOPED,
): Promise<readonly GroupPressure[]> {
  const rows = await openDemand(ctx, scope);

  return STOCK_DISPLAY_ORDER.map((group) => {
    const mine = rows.filter((row) => row.bloodGroup === group);

    const unitsRequired = mine.reduce((sum, row) => sum + row.units, 0);
    const unitsConfirmed = mine.reduce((sum, row) => sum + row.confirmedUnits, 0);
    const belowFloor = mine.some((row) => row.trigger === 'stock_floor');

    return {
      bloodGroup: group,
      level: pressureFor(
        { unitsRequired, unitsConfirmed, belowFloor },
        {
          recruiting: ctx.config.pressure.recruitingFraction,
          short: ctx.config.pressure.shortFraction,
        },
      ),
      unitsRequired,
      unitsConfirmed,
      unitsOutstanding: unitsOutstanding({ unitsRequired, unitsConfirmed, belowFloor }),
      donorsNotified: mine.reduce((sum, row) => sum + row.donorsNotified, 0),
      openDemands: mine.length,
      belowFloor,
    };
  });
}

/** What is behind a tile: the open demands for one group, soonest first. */
export async function demandsForGroup(
  ctx: UseCaseContext,
  group: BloodGroup,
  scope: Scope = UNSCOPED,
): Promise<readonly DemandLine[]> {
  const rows = await openDemand(ctx, scope);

  return rows
    .filter((row) => row.bloodGroup === group)
    .map(toLine)
    .sort((a, b) => a.neededBy.localeCompare(b.neededBy));
}

/**
 * The public board (§9.4).
 *
 * No account, no scoping, no sharing tools, one page anybody can open or
 * forward. Demands with nothing outstanding are dropped rather than shown as
 * covered: an outsider reading this is deciding whether to walk in, and a line
 * that needs nobody is noise on that decision.
 */
export async function publicBoard(
  ctx: UseCaseContext,
): Promise<readonly PublicDemandRow[]> {
  const rows = await openDemand(ctx, UNSCOPED);

  return rows
    .map(toLine)
    .filter((line) => line.unitsOutstanding > 0)
    .sort(
      (a, b) =>
        a.neededBy.localeCompare(b.neededBy) ||
        a.hospitalName.localeCompare(b.hospitalName),
    )
    .map((line) => ({
      bloodGroup: line.bloodGroup,
      hospitalName: line.hospitalName,
      town: line.town,
      unitsOutstanding: line.unitsOutstanding,
      neededBy: line.neededBy,
    }));
}

/**
 * Units asked for against units met, by week (§6).
 *
 * The only place aggregate history is shown, and it is shown lightly: a
 * volunteer wants to know whether the effort is working, not to run a report.
 *
 * Bucketed by `date_required` rather than by when a demand closed, because that
 * is the week the blood was actually needed, and because `donor_demand` has no
 * closed-at column, so the alternative would be `updated_at`, which moves every
 * time a counter increments.
 */
export async function trend(
  ctx: UseCaseContext,
  options: { weeks: number; group?: BloodGroup; scope?: Scope } = { weeks: 6 },
): Promise<readonly TrendPoint[]> {
  const scope = options.scope ?? UNSCOPED;
  const now = ctx.clock.now();

  /*
   * A calendar day, not an instant. `date_required` is a `date`, and the driver
   * cannot bind a JavaScript Date into a raw fragment at all. It throws before
   * Postgres sees the query. This is the fourth time that has bitten, so the
   * conversion is explicit rather than incidental.
   */
  const from = new Date(now.getTime() - options.weeks * 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const weekStart = sql<string>`to_char(date_trunc('week', ${donorDemand.dateRequired}), 'YYYY-MM-DD')`;

  const rows = await ctx.db
    .select({
      weekStart,
      unitsRequired: sql<number>`coalesce(sum(${donorDemand.units}), 0)::int`,
      unitsMet: sql<number>`coalesce(sum(${donorDemand.completedUnits}), 0)::int`,
    })
    .from(donorDemand)
    .where(
      and(
        gte(donorDemand.dateRequired, sql`${from}::date`),
        options.group ? eq(donorDemand.bloodGroup, options.group) : undefined,
        scope.districtId === null
          ? undefined
          : eq(donorDemand.districtId, scope.districtId),
      ),
    )
    .groupBy(weekStart)
    .orderBy(weekStart);

  return rows;
}

/* -------------------------------------------------------------------------- */

type Raw = Awaited<ReturnType<typeof openDemand>>[number];

function toLine(row: Raw): DemandLine {
  const unitsRequired = row.units;
  const unitsConfirmed = row.confirmedUnits;

  return {
    id: row.id,
    bloodGroup: row.bloodGroup as BloodGroup,
    hospitalName: row.hospitalName,
    town: row.town,
    unitsRequired,
    unitsConfirmed,
    unitsOutstanding: Math.max(0, unitsRequired - unitsConfirmed),
    donorsNotified: row.donorsNotified,
    neededBy: row.dateRequired,
    forStockFloor: row.trigger === 'stock_floor',
  };
}

/** Guards a group arriving from a URL, so a tile link cannot become a probe. */
export function asBloodGroup(value: string | undefined): BloodGroup | null {
  return BLOOD_GROUPS.includes(value as BloodGroup) ? (value as BloodGroup) : null;
}
