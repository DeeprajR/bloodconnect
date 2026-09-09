/**
 * The demand board — for the donor who comes looking anyway (§5).
 *
 * "Not everyone waits to be asked. Some people want to give because they read
 * something, or because a friend needed blood last month, and they open the bot
 * on their own."
 *
 * Three rules §5 sets, and each exists because the alternative loses somebody:
 *
 *  1. **Open to everyone** — registered or not, eligible or not. A visitor
 *     asking "what is needed?" gets an answer, not a signup form.
 *  2. **Matches first, for a registered donor**, marked as such, with the rest
 *     below. Tapping a match enters the same accept → screen → confirm flow as a
 *     pushed request; there is one path, not two.
 *  3. **When a donor does not qualify, say why, once, without a lecture.** A
 *     donor who understands why they were skipped stays; one who feels ignored
 *     leaves.
 *
 * It shows no patient detail: hospital, town, group, units outstanding and the
 * day (§2.10). And it does not ask — being asked is a wave, with a journey row
 * behind it. This is a list somebody chose to look at, so it creates nothing.
 */

import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import { botRequests, donorRequests, donors } from '@blood-connect/db/bot';
import {
  compatibleRecipientGroupsFor,
  hasIntervalElapsed,
  parseCalendarDay,
  type BloodGroup,
} from '@blood-connect/domain';

import type { BotContext } from '../context.js';
import type { HospitalSnapshot } from '../messages.js';

export type BoardEntry = {
  readonly publicId: string;
  readonly bloodGroup: string;
  readonly unitsOutstanding: number;
  readonly neededBy: string;
  readonly hospital: HospitalSnapshot;
  /** True when this viewer's group could answer it. */
  readonly matchesMe: boolean;
  /** True when they have already been asked about this one. */
  readonly alreadyAsked: boolean;
};

/**
 * Why this viewer cannot answer a request they are looking at (§5).
 *
 * Said once, plainly, and never as a lecture. `null` means they can.
 */
export type BoardBlock =
  | { readonly reason: 'not_registered' }
  | { readonly reason: 'group_unverified' }
  | { readonly reason: 'interval'; readonly until: string }
  | { readonly reason: 'paused'; readonly until: string }
  | { readonly reason: 'wrong_group'; readonly needed: string }
  | { readonly reason: 'flagged' };

export type Board = {
  readonly entries: readonly BoardEntry[];
  /** Absent for a visitor with no profile — there is nothing to block yet. */
  readonly blocked: BoardBlock | null;
};

/**
 * Everything open, with this viewer's matches first.
 *
 * `donorId` is optional on purpose: the board is the one screen that answers a
 * stranger.
 */
export async function openBoard(
  ctx: BotContext,
  donorId?: string,
  limit = 10,
): Promise<Board> {
  const today = ctx.clock.today();

  const rows = await ctx.db
    .select({
      id: botRequests.id,
      publicId: botRequests.publicId,
      bloodGroup: botRequests.bloodGroup,
      unitsNeeded: botRequests.unitsNeeded,
      confirmedCount: botRequests.confirmedCount,
      walkInUnits: botRequests.walkInUnits,
      neededBy: botRequests.neededBy,
      hospitalSnapshot: botRequests.hospitalSnapshot,
    })
    .from(botRequests)
    .where(
      and(
        eq(botRequests.status, 'open'),
        // Not past the day it was needed. The ticker closes these, but a donor
        // should never see one in the window before it does.
        gte(botRequests.neededBy, today),
      ),
    )
    .orderBy(asc(botRequests.neededBy))
    .limit(limit * 2);

  if (donorId === undefined) {
    return {
      entries: rows.slice(0, limit).map((row) => toEntry(row, false, false)),
      blocked: { reason: 'not_registered' },
    };
  }

  const [donor] = await ctx.db
    .select({
      bloodGroup: donors.bloodGroup,
      bloodGroupVerifiedAt: donors.bloodGroupVerifiedAt,
      nextEligibleOn: donors.nextEligibleOn,
      snoozeUntil: donors.snoozeUntil,
      durableFlagStatus: donors.durableFlagStatus,
    })
    .from(donors)
    .where(eq(donors.id, donorId));

  if (!donor) {
    return {
      entries: rows.slice(0, limit).map((row) => toEntry(row, false, false)),
      blocked: { reason: 'not_registered' },
    };
  }

  // Which open requests could this donor's blood answer? The red-cell direction
  // runs the other way from recruitment (§2).
  const answerable = new Set(
    compatibleRecipientGroupsFor(donor.bloodGroup as BloodGroup) as readonly string[],
  );

  const asked =
    rows.length === 0
      ? []
      : await ctx.db
          .select({ botRequestId: donorRequests.botRequestId })
          .from(donorRequests)
          .where(
            and(
              eq(donorRequests.donorId, donorId),
              inArray(
                donorRequests.botRequestId,
                rows.map((row) => row.id),
              ),
            ),
          );
  const askedIds = new Set(asked.map((row) => row.botRequestId));

  const entries = rows
    .map((row) => toEntry(row, answerable.has(row.bloodGroup), askedIds.has(row.id)))
    // Matches first, and marked as such (§5); the rest stay visible below.
    .sort((a, b) => Number(b.matchesMe) - Number(a.matchesMe))
    .slice(0, limit);

  return { entries, blocked: blockFor(donor, today) };
}

function toEntry(
  row: {
    publicId: string;
    bloodGroup: string;
    unitsNeeded: number;
    confirmedCount: number;
    walkInUnits: number;
    neededBy: string;
    hospitalSnapshot: unknown;
  },
  matchesMe: boolean,
  alreadyAsked: boolean,
): BoardEntry {
  return {
    publicId: row.publicId,
    bloodGroup: row.bloodGroup,
    // Units already collected at the counter are not outstanding, whoever gave
    // them (contract 1.2.0).
    unitsOutstanding: Math.max(0, row.unitsNeeded - row.confirmedCount - row.walkInUnits),
    neededBy: row.neededBy,
    hospital: row.hospitalSnapshot as HospitalSnapshot,
    matchesMe,
    alreadyAsked,
  };
}

/**
 * The first reason this donor cannot answer anything, or `null`.
 *
 * Ordered by what they can act on: a group staff can type comes before an
 * interval they can only wait out.
 */
function blockFor(
  donor: {
    bloodGroupVerifiedAt: Date | null;
    nextEligibleOn: string | null;
    snoozeUntil: string | null;
    durableFlagStatus: string;
  },
  today: string,
): BoardBlock | null {
  if (donor.bloodGroupVerifiedAt === null) return { reason: 'group_unverified' };
  if (donor.durableFlagStatus !== 'clear') return { reason: 'flagged' };
  if (donor.snoozeUntil !== null && donor.snoozeUntil > today) {
    return { reason: 'paused', until: donor.snoozeUntil };
  }

  const eligible = parseCalendarDay(donor.nextEligibleOn ?? '');
  if (!hasIntervalElapsed(eligible, today as never)) {
    return { reason: 'interval', until: donor.nextEligibleOn ?? '' };
  }

  return null;
}

/**
 * One request by its public id — the deep link's target (§5).
 *
 * "A donor arriving on a request link is onboarded first, then lands back on
 * that request — the link is never lost."
 */
export async function requestByPublicId(
  ctx: BotContext,
  publicId: string,
): Promise<{ botRequestId: string; bloodGroup: string; neededBy: string; hospital: HospitalSnapshot } | undefined> {
  const [row] = await ctx.db
    .select({
      botRequestId: botRequests.id,
      bloodGroup: botRequests.bloodGroup,
      neededBy: botRequests.neededBy,
      hospitalSnapshot: botRequests.hospitalSnapshot,
      status: botRequests.status,
    })
    .from(botRequests)
    .where(eq(botRequests.publicId, publicId));

  if (!row) return undefined;

  return {
    botRequestId: row.botRequestId,
    bloodGroup: row.bloodGroup,
    neededBy: row.neededBy,
    hospital: row.hospitalSnapshot as HospitalSnapshot,
  };
}

/**
 * The journey row for a donor tapping a request they were never pushed.
 *
 * Created on demand so the board's "accept" is the *same* flow as a pushed
 * card's — §5 is explicit that there is one path and not two. It counts as a
 * notification the moment they see the card, which is what `notified_at` means
 * here, but it is not part of a wave and does not touch the wave counters.
 */
export async function journeyForBoardTap(
  ctx: BotContext,
  botRequestId: string,
  donorId: string,
): Promise<string | undefined> {
  const now = ctx.clock.now();

  const [existing] = await ctx.db
    .select({ id: donorRequests.id })
    .from(donorRequests)
    .where(
      and(
        eq(donorRequests.botRequestId, botRequestId),
        eq(donorRequests.donorId, donorId),
      ),
    );

  // Already asked: the same journey, not a second one. A donor who taps the
  // board after being pushed the card must not end up with two.
  if (existing) return existing.id;

  const id = ctx.ids.next<'JourneyId'>();
  const inserted = await ctx.db
    .insert(donorRequests)
    .values({
      id,
      botRequestId,
      donorId,
      status: 'NOTIFIED',
      notifiedAt: now,
      /**
       * Wave zero: this donor was not in a wave at all, they came looking.
       *
       * The column is how §7.7's escalation is counted, and a board tap must
       * not inflate it — a request that reached nobody would otherwise look
       * like it had already escalated once.
       */
      waveNo: 0,
      screeningAnswers: {},
      screeningIndex: 0,
    })
    .onConflictDoNothing()
    .returning({ id: donorRequests.id });

  return inserted[0]?.id ?? existing;
}

/** How many are open right now, for the one-line answer. */
export async function openCount(ctx: BotContext): Promise<number> {
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(botRequests)
    .where(and(eq(botRequests.status, 'open'), gte(botRequests.neededBy, ctx.clock.today())));

  return row?.n ?? 0;
}
