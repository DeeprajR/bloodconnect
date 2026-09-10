/**
 * Where a donor lives, in four levels (§5, §5.8).
 *
 * District → city/taluk → town → locality. It exists for one reason: a wave
 * reaches the people closest to the hospital first, and that ordering is the
 * single biggest lever on whether somebody actually turns up. A pool that only
 * knew the district would wake half a city for a hospital two streets away.
 *
 * **Matched against the reference dataset, never stored as typed.** Kerala
 * locality names have several romanised spellings each, Koyilandy and Quilandy
 * are one place, and a donor pool keyed on free text cannot be sorted by
 * proximity, because the same place appears four ways. So the matched id is
 * stored, with the donor's own wording kept beside it for the reviewer.
 *
 * Free text is accepted only as a last resort and lands in a review queue rather
 * than silently creating a place (§5).
 */

import { and, asc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import { locationNodes } from '@blood-connect/db';

import type { BotContext } from '../context.js';

/** The four levels, outermost first. The order is the order they are asked. */
export const LOCATION_LEVELS = ['district', 'city', 'town', 'locality'] as const;
export type LocationLevel = (typeof LOCATION_LEVELS)[number];

export type LocationNode = {
  readonly id: string;
  readonly name: string;
};

/**
 * The level below this one, or `undefined` at the bottom.
 *
 * Used to walk down the chain, and to know when the chain has ended, which is
 * also what makes "changing the district resets everything under it" (§5) a
 * loop rather than four special cases.
 */
export function levelBelow(level: LocationLevel): LocationLevel | undefined {
  const index = LOCATION_LEVELS.indexOf(level);
  return LOCATION_LEVELS[index + 1];
}

/**
 * Normalises a donor's typing the way the dataset is normalised (§5.8).
 *
 * `name_normalised` is lowercased with punctuation stripped, so the search term
 * has to be put through the same treatment or "Koyilandy," never matches
 * anything. The seed builds that column with the same rule.
 */
export const normalise = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFKD')
    // Strip accents, then anything that is not a letter, digit or space.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Every district in the dataset. The one level offered as a plain list. */
export async function listDistricts(
  ctx: BotContext,
  limit = 40,
): Promise<LocationNode[]> {
  return ctx.db
    .select({ id: locationNodes.id, name: locationNodes.name })
    .from(locationNodes)
    .where(and(eq(locationNodes.level, 'district'), isNull(locationNodes.parentId)))
    .orderBy(asc(locationNodes.name))
    .limit(limit);
}

/**
 * The children of one node, for the level below it.
 *
 * A short list is offered whole. A district with four cities in it does not
 * need a type-ahead, and making somebody type when four buttons would do is
 * worse than either.
 */
export async function listChildren(
  ctx: BotContext,
  parentId: string,
  limit = 40,
): Promise<LocationNode[]> {
  return ctx.db
    .select({ id: locationNodes.id, name: locationNodes.name })
    .from(locationNodes)
    .where(eq(locationNodes.parentId, parentId))
    .orderBy(asc(locationNodes.name))
    .limit(limit);
}

/**
 * The type-ahead: children of `parentId` matching what the donor typed.
 *
 * Scoped to the level above, always. An unscoped search would offer a town from
 * another district that happens to share a name, and the donor would have no
 * way to tell which one they picked.
 *
 * Matches a prefix **and** an interior word, because "Feroke" should be found by
 * typing "fer" and "Cheruvannur / Nallalam" by typing "nall". The dataset's
 * names carry alternatives separated by slashes, and only matching the start
 * would hide half of them.
 */
export async function searchChildren(
  ctx: BotContext,
  parentId: string,
  term: string,
  limit = 10,
): Promise<LocationNode[]> {
  const needle = normalise(term);
  if (needle.length === 0) return listChildren(ctx, parentId, limit);

  return ctx.db
    .select({ id: locationNodes.id, name: locationNodes.name })
    .from(locationNodes)
    .where(
      and(
        eq(locationNodes.parentId, parentId),
        or(
          like(locationNodes.nameNormalised, `${needle}%`),
          like(locationNodes.nameNormalised, `% ${needle}%`),
        ),
      ),
    )
    // A prefix match first: somebody typing "fer" means Feroke before it means
    // anything with "fer" in the middle of it.
    .orderBy(
      sql`CASE WHEN ${locationNodes.nameNormalised} LIKE ${`${needle}%`} THEN 0 ELSE 1 END`,
      asc(locationNodes.name),
    )
    .limit(limit);
}

/** One node by id, to confirm a choice actually exists before storing it. */
export async function nodeById(
  ctx: BotContext,
  id: string,
): Promise<{ id: string; name: string; level: string; parentId: string | null } | undefined> {
  const [row] = await ctx.db
    .select({
      id: locationNodes.id,
      name: locationNodes.name,
      level: locationNodes.level,
      parentId: locationNodes.parentId,
    })
    .from(locationNodes)
    .where(eq(locationNodes.id, id));

  return row;
}

export type LocationChoice = {
  readonly districtId?: string | undefined;
  readonly cityId?: string | undefined;
  readonly townId?: string | undefined;
  readonly localityId?: string | undefined;
};

/**
 * The path as one line: "Kozhikode › Kozhikode › Feroke › Karuvanthiruthi".
 *
 * Read back on the summary, so the donor confirms a place they recognise rather
 * than four ids. Levels not yet chosen are simply absent: a donor who stopped at
 * the town sees three parts, not three parts and a gap.
 */
export async function describeLocation(
  ctx: BotContext,
  choice: LocationChoice,
): Promise<string> {
  const ids = [choice.districtId, choice.cityId, choice.townId, choice.localityId].filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );
  if (ids.length === 0) return '';

  const rows = await ctx.db
    .select({ id: locationNodes.id, name: locationNodes.name })
    .from(locationNodes)
    /*
      `inArray`, not `ANY(${ids})`: Drizzle expands a JS array inside a raw
      `sql` into a tuple, `($1, $2, $3)`, which Postgres refuses on the right
      of ANY. It fails loudly here; the same mistake in a filter would simply
      have matched nothing.
    */
    .where(inArray(locationNodes.id, ids));

  const byId = new Map(rows.map((row) => [row.id, row.name]));
  return ids
    .map((id) => byId.get(id))
    .filter((name): name is string => name !== undefined)
    .join(' › ');
}

/**
 * Does this level need asking at all?
 *
 * A node with no children below it ends the chain. Kozhikode's dataset has
 * towns with no localities under them, and asking "which locality?" with an
 * empty list is a dead end the donor cannot get out of.
 */
export async function hasChildren(ctx: BotContext, parentId: string): Promise<boolean> {
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(locationNodes)
    .where(eq(locationNodes.parentId, parentId));

  return (row?.n ?? 0) > 0;
}
