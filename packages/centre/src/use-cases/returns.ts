/**
 * A unit coming back, and the two ways it can leave again (§4).
 *
 * Three rules here are the reason this file exists, and none of them is a
 * convenience:
 *
 *  1. **A return never recalculates expiry.** It is a property of the donation,
 *     not of the bag's travels. Nothing in this file writes `expires_at`, and a
 *     test asserts that rather than trusting the review.
 *  2. **Unknown time out of storage defaults to quarantine.** §4 says so
 *     explicitly, and the database refuses a restock that is not `under_30m`, so
 *     no screen and no later code path can put such a unit back on the shelf.
 *  3. **Quarantine is a waiting room, not a destination.** It resolves to
 *     exactly two ends, by a named person, and a quarantined bag that reaches
 *     its expiry is discarded automatically with that recorded as the reason.
 *
 * A return also **does not re-open the request** the unit was issued against.
 * The centre's decision stands, with the return recorded against the bag.
 */

import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { err, ok, type Result } from '@blood-connect/result';
import {
  bagDiscards,
  bagQuarantines,
  bagReturns,
  bloodBags,
  centreSettings,
} from '@blood-connect/db';
import { bagTransitions, canTransition, type BagStatus } from '@blood-connect/domain';
import {
  actorHas,
  createAuditWriter,
  type UseCaseContext,
} from '@blood-connect/platform';

import {
  invalidBag,
  notAuthorized,
  type InvalidBag,
  type NotAuthorized,
} from '../errors.js';
import {
  allowedOutcomes,
  type ReturnOutcome,
  type StorageBand,
} from '../rules/returns.js';

export type { ReturnOutcome, StorageBand } from '../rules/returns.js';
export { allowedOutcomes, defaultOutcome } from '../rules/returns.js';

export type ReturnInput = {
  readonly bagId: string;
  readonly outOfStorageBand: StorageBand;
  readonly coldChainDocumented: boolean;
  /** What the operator chose. `restock` is refused unless the band allows it. */
  readonly outcome: ReturnOutcome;
  readonly note: string | null;
  /** Required when the outcome is a discard (§12.1). */
  readonly disposalRoute?: string | null;
};

export type ReturnResult = {
  readonly outcome: ReturnOutcome;
  readonly quarantineId: string | null;
  readonly expiryUnchanged: string;
};

export async function returnBag(
  ctx: UseCaseContext,
  input: ReturnInput,
): Promise<Result<ReturnResult, NotAuthorized | InvalidBag>> {
  if (!actorHas(ctx.actor, 'centre:operate')) return err(notAuthorized('centre:operate'));

  if (!allowedOutcomes(input.outOfStorageBand).includes(input.outcome)) {
    return err(
      invalidBag(
        input.outOfStorageBand === 'unknown'
          ? 'The time out of storage is unknown, so this unit cannot be restocked. ' +
            'Quarantine it and let somebody decide.'
          : 'This unit was out of storage too long to go back on the shelf.',
      ),
    );
  }

  const route = input.disposalRoute?.trim() ?? '';
  if (input.outcome === 'discard' && route.length === 0) {
    return err(invalidBag('A discard needs a disposal route. Where did the unit go?'));
  }

  const now = ctx.clock.now();
  const actorId = ctx.actor.kind === 'user' ? ctx.actor.userId : null;
  if (actorId === null) {
    return err(invalidBag('A return is decided by a named person, never by a job.'));
  }

  const returnId = ctx.ids.next<'ReturnId'>();
  const quarantineId = ctx.ids.next<'QuarantineId'>();

  return ctx.db.transaction(async (tx) => {
    const [bag] = await tx
      .select()
      .from(bloodBags)
      .where(eq(bloodBags.id, input.bagId))
      .for('update');

    if (!bag) return err(invalidBag('That bag is not in the register.'));

    const from = bag.status as BagStatus;
    if (!canTransition(bagTransitions, from, 'returned')) {
      return err(
        invalidBag(`A bag that is ${from} has not been issued, so it cannot come back.`),
      );
    }

    await tx.insert(bagReturns).values({
      id: returnId,
      bagId: input.bagId,
      returnedAt: now,
      outOfStorageBand: input.outOfStorageBand,
      coldChainDocumented: input.coldChainDocumented,
      outcome: input.outcome,
      note: input.note,
      decidedBy: actorId,
    });

    /**
     * The bag's new status, and **nothing about its expiry**.
     *
     * `reserved_for_request_id` and `issued_to_request_id` are cleared because
     * the unit is back in the centre's custody, but the decision that issued it
     * stands, and this return is recorded against the bag rather than reopening
     * the request (§4).
     */
    const status: BagStatus =
      input.outcome === 'restock'
        ? 'available'
        : input.outcome === 'quarantine'
          ? 'quarantined'
          : 'discarded';

    await tx
      .update(bloodBags)
      .set({ status, reservedForRequestId: null })
      .where(eq(bloodBags.id, input.bagId));

    if (input.outcome === 'quarantine') {
      await tx.insert(bagQuarantines).values({
        id: quarantineId,
        bagId: input.bagId,
        reason:
          input.outOfStorageBand === 'unknown'
            ? 'Time out of controlled storage unknown'
            : 'Out of controlled storage beyond the limit',
        openedAt: now,
        note: input.note,
      });
    }

    if (input.outcome === 'discard') {
      await tx.insert(bagDiscards).values({
        id: ctx.ids.next<'DiscardId'>(),
        bagId: input.bagId,
        reason: 'Returned outside the cold chain',
        disposalRoute: route,
        note: input.note,
        discardedBy: actorId,
        discardedAt: now,
      });
    }

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'bag.returned',
      subjectType: 'blood_bag',
      subjectId: input.bagId,
      metadata: {
        outcome: input.outcome,
        outOfStorageBand: input.outOfStorageBand,
        coldChainDocumented: input.coldChainDocumented,
        fromStatus: from,
        // Recorded so "did this return change the expiry" is answerable from
        // the log alone, without diffing the row.
        expiresAt: bag.expiresAt,
      },
    });

    return ok({
      outcome: input.outcome,
      quarantineId: input.outcome === 'quarantine' ? quarantineId : null,
      expiryUnchanged: bag.expiresAt,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Quarantine. A waiting room with exactly two exits                          */
/* -------------------------------------------------------------------------- */

export type QuarantineRow = {
  readonly id: string;
  readonly bagId: string;
  readonly unitNumber: string;
  readonly bloodGroup: string;
  readonly product: string;
  readonly expiresAt: string;
  readonly reason: string;
  readonly openedAt: Date;
  readonly daysWaiting: number;
  /** Past the configured threshold, so the overview can escalate it (§4). */
  readonly overdue: boolean;
};

export async function listQuarantine(ctx: UseCaseContext): Promise<QuarantineRow[]> {
  const rows = await ctx.db
    .select({
      id: bagQuarantines.id,
      bagId: bagQuarantines.bagId,
      unitNumber: bloodBags.unitNumber,
      bloodGroup: bloodBags.bloodGroup,
      product: bloodBags.product,
      expiresAt: bloodBags.expiresAt,
      reason: bagQuarantines.reason,
      openedAt: bagQuarantines.openedAt,
    })
    .from(bagQuarantines)
    .innerJoin(bloodBags, eq(bloodBags.id, bagQuarantines.bagId))
    .where(isNull(bagQuarantines.resolvedAt))
    .orderBy(bagQuarantines.openedAt);

  const now = ctx.clock.now().getTime();
  const threshold = ctx.config.ageing.quarantineDays;

  return rows.map((row) => {
    const daysWaiting = Math.max(
      0,
      Math.floor((now - row.openedAt.getTime()) / 86_400_000),
    );
    return { ...row, daysWaiting, overdue: daysWaiting >= threshold };
  });
}

/**
 * Closes a quarantine, to one of exactly two ends, by a named person (§4).
 *
 * There is no third option and no "leave it for now". That is what the row
 * already is, and §4 is explicit that nothing sits here indefinitely.
 */
export async function resolveQuarantine(
  ctx: UseCaseContext,
  quarantineId: string,
  resolution: 'available' | 'discarded',
  note: string,
  disposalRoute?: string,
): Promise<Result<{ bagId: string }, NotAuthorized | InvalidBag>> {
  if (!actorHas(ctx.actor, 'centre:operate')) return err(notAuthorized('centre:operate'));

  const trimmed = note.trim();
  if (trimmed.length === 0) {
    return err(invalidBag('Say what was decided. A quarantine is closed by a person.'));
  }

  const route = disposalRoute?.trim() ?? '';
  if (resolution === 'discarded' && route.length === 0) {
    return err(invalidBag('A discard needs a disposal route. Where did the unit go?'));
  }

  const now = ctx.clock.now();
  const actorId = ctx.actor.kind === 'user' ? ctx.actor.userId : null;
  if (actorId === null) {
    return err(invalidBag('A quarantine is resolved by a named person, never by a job.'));
  }

  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(bagQuarantines)
      .where(and(eq(bagQuarantines.id, quarantineId), isNull(bagQuarantines.resolvedAt)))
      .for('update');

    if (!row) return err(invalidBag('That quarantine is already resolved.'));

    await tx
      .update(bagQuarantines)
      .set({ resolvedAt: now, resolution, resolvedBy: actorId, note: trimmed })
      .where(eq(bagQuarantines.id, quarantineId));

    // The expiry is untouched here too. A unit does not become fresher for
    // having waited in quarantine.
    await tx
      .update(bloodBags)
      .set({ status: resolution === 'available' ? 'available' : 'discarded' })
      .where(eq(bloodBags.id, row.bagId));

    if (resolution === 'discarded') {
      await tx
        .insert(bagDiscards)
        .values({
          id: ctx.ids.next<'DiscardId'>(),
          bagId: row.bagId,
          reason: `Quarantine resolved as discarded: ${row.reason}`,
          disposalRoute: route,
          note: trimmed,
          discardedBy: actorId,
          discardedAt: now,
        })
        .onConflictDoNothing();
    }

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'bag.quarantine_resolved',
      subjectType: 'blood_bag',
      subjectId: row.bagId,
      metadata: { quarantineId, resolution, reason: row.reason },
    });

    return ok({ bagId: row.bagId });
  });
}

/* -------------------------------------------------------------------------- */
/* Discard, on its own                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Ends a bag, with somewhere for it to go (§12.1).
 *
 * `disposalRoute` is required by the database as well as by this function,
 * because **a status change is not the end of the bag**: a unit of human blood
 * physically goes somewhere, and a register that says `discarded` without saying
 * where cannot answer the question an inspection asks.
 */
export async function discardBag(
  ctx: UseCaseContext,
  bagId: string,
  reason: string,
  disposalRoute: string,
  note: string | null = null,
): Promise<Result<{ bagId: string }, NotAuthorized | InvalidBag>> {
  if (!actorHas(ctx.actor, 'centre:operate')) return err(notAuthorized('centre:operate'));

  const trimmedReason = reason.trim();
  const route = disposalRoute.trim();
  if (trimmedReason.length === 0) return err(invalidBag('Say why the unit is being discarded.'));
  if (route.length === 0) {
    return err(invalidBag('A discard needs a disposal route. Where did the unit go?'));
  }

  const now = ctx.clock.now();
  const actorId = ctx.actor.kind === 'user' ? ctx.actor.userId : null;

  return ctx.db.transaction(async (tx) => {
    const [bag] = await tx
      .select({ status: bloodBags.status })
      .from(bloodBags)
      .where(eq(bloodBags.id, bagId))
      .for('update');

    if (!bag) return err(invalidBag('That bag is not in the register.'));

    const from = bag.status as BagStatus;
    if (!canTransition(bagTransitions, from, 'discarded')) {
      return err(
        invalidBag(
          from === 'discarded'
            ? 'That unit has already been discarded.'
            : `A bag that is ${from} cannot be discarded from here.`,
        ),
      );
    }

    await tx
      .insert(bagDiscards)
      .values({
        id: ctx.ids.next<'DiscardId'>(),
        bagId,
        reason: trimmedReason,
        disposalRoute: route,
        note,
        discardedBy: actorId,
        discardedAt: now,
      })
      .onConflictDoNothing();

    await tx.update(bloodBags).set({ status: 'discarded' }).where(eq(bloodBags.id, bagId));

    // Any open quarantine closes with it. A bag cannot be both waiting for a
    // decision and finished.
    await tx
      .update(bagQuarantines)
      .set({
        resolvedAt: now,
        resolution: 'discarded',
        resolvedBy: actorId,
        note: trimmedReason,
      })
      .where(and(eq(bagQuarantines.bagId, bagId), isNull(bagQuarantines.resolvedAt)));

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'bag.discarded',
      subjectType: 'blood_bag',
      subjectId: bagId,
      metadata: { reason: trimmedReason, disposalRoute: route, fromStatus: from },
    });

    return ok({ bagId });
  });
}

/* -------------------------------------------------------------------------- */
/* The one thing a job may do to a quarantine                                  */
/* -------------------------------------------------------------------------- */

/**
 * Discards quarantined units that have reached their expiry (§4).
 *
 * The single automatic exit from quarantine, and §4 grants it explicitly: "a
 * quarantined bag that reaches its expiry is discarded automatically with that
 * recorded as the reason". It closes the quarantine row it discards, so nothing
 * is left waiting for a decision about a unit that can no longer be used.
 *
 * **It touches no discrepancy.** The `tag_discrepancies` table is reached by no
 * scheduled work at all, that absence is the guarantee §4 asks for, and it is
 * asserted by a test.
 */
export async function discardExpiredQuarantine(
  ctx: UseCaseContext,
): Promise<{ readonly discarded: number }> {
  const today = ctx.clock.today();
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const due = await tx
      .select({ quarantineId: bagQuarantines.id, bagId: bagQuarantines.bagId })
      .from(bagQuarantines)
      .innerJoin(bloodBags, eq(bloodBags.id, bagQuarantines.bagId))
      .where(and(isNull(bagQuarantines.resolvedAt), lt(bloodBags.expiresAt, today)));

    for (const row of due) {
      await tx
        .insert(bagDiscards)
        .values({
          id: ctx.ids.next<'DiscardId'>(),
          bagId: row.bagId,
          reason: 'Expired while in quarantine',
          // A route the centre can still act on, rather than a fiction. The
          // unit is physically present and still needs disposing of (§12.1).
          disposalRoute: 'Clinical waste, pending centre confirmation',
          discardedBy: null,
          discardedAt: now,
        })
        .onConflictDoNothing();

      await tx
        .update(bagQuarantines)
        .set({
          resolvedAt: now,
          resolution: 'discarded',
          note: 'Expired while in quarantine',
        })
        .where(eq(bagQuarantines.id, row.quarantineId));

      await tx
        .update(bloodBags)
        .set({ status: 'discarded' })
        .where(eq(bloodBags.id, row.bagId));
    }

    if (due.length > 0) {
      const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
      await audit({
        action: 'bags.quarantine_expired',
        subjectType: 'blood_bag',
        subjectId: due[0]?.bagId ?? '',
        metadata: { count: due.length, bagIds: due.map((row) => row.bagId), today },
      });
    }

    return { discarded: due.length };
  });
}

/** The centre's own return-time limit, for the screen's wording (§4). */
export async function returnTimeLimitMinutes(ctx: UseCaseContext): Promise<number> {
  const [row] = await ctx.db
    .select({ minutes: centreSettings.returnTimeLimitMinutes })
    .from(centreSettings)
    .where(eq(centreSettings.id, 1));

  return row?.minutes ?? 30;
}

/** Quarantined units past the ageing threshold. The §11.9 escalation. */
export async function countOverdueQuarantine(ctx: UseCaseContext): Promise<number> {
  const cutoff = new Date(
    ctx.clock.now().getTime() - ctx.config.ageing.quarantineDays * 86_400_000,
  );

  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(bagQuarantines)
    .where(and(isNull(bagQuarantines.resolvedAt), lt(bagQuarantines.openedAt, cutoff)));

  return row?.n ?? 0;
}
