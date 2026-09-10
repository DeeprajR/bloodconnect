/**
 * Cancelling a submitted request (§3, §8).
 *
 * The doctor's one post-submit action, and the one the whole loop is judged on:
 * *"without it the centre chases units nobody needs"* (§3), and §14 names a
 * confirmed donor travelling to a hospital that no longer needs them as the
 * failure this system most has to avoid.
 *
 * Three modules' tables change together, and they must:
 *
 *   1. The **request** moves to `cancelled` with a reason (Module 1).
 *   2. Any **reserved bags** go back on the shelf (Module 2).
 *   3. Any **open demand** raised for it is withdrawn (the shared contract),
 *      which the bot's ticker turns into a stand-down for every donor still
 *      holding a place (§7.6).
 *
 * A request showing cancelled while units stay held for it, or while donors are
 * still being recruited, is worse than not cancelling at all, so it is one
 * transaction.
 *
 * **Why this lives in `packages/centre` when a doctor performs it.** §11.2 lets
 * exactly one of these two modules see the other, and it is this one. Module 1
 * cannot name `blood_bags` or `donor_demand`; this module can, and it reaches
 * the request through `hospital`'s own narrow seam rather than its tables. The
 * permission checked below is the doctor's, not the counter's. Where a use case
 * lives and who may run it are different questions.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { err, ok, type Result } from '@blood-connect/result';
import { bloodBags, donorDemand } from '@blood-connect/db';
import { doctorOf, markRequestCancelled } from '@blood-connect/hospital';
import {
  actorHas,
  createAuditWriter,
  type UseCaseContext,
} from '@blood-connect/platform';

import {
  invalidBag,
  notAuthorized,
  requestNotDecidable,
  requestNotFound,
  type InvalidBag,
  type NotAuthorized,
  type RequestNotDecidable,
  type RequestNotFound,
} from '../errors.js';

export type CancelResult = {
  readonly cancelledFrom: string;
  /** Units put back on the shelf. Zero unless the request had been decided. */
  readonly bagsReleased: number;
  /** Demands withdrawn. The bot stands their donors down (§7.6). */
  readonly demandsCancelled: number;
};

export type CancelError =
  | NotAuthorized
  | RequestNotFound
  | RequestNotDecidable
  | InvalidBag;

export async function cancelRequest(
  ctx: UseCaseContext,
  requestUuid: string,
  reason: string,
): Promise<Result<CancelResult, CancelError>> {
  // The doctor's action, not the counter's (§9). A centre account cannot
  // withdraw a ward's request any more than it can raise one.
  if (!actorHas(ctx.actor, 'requests:manage')) return err(notAuthorized('requests:manage'));

  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    /**
     * §3 requires a reason, and this is why: the centre may already have pulled
     * units, and donors may already have agreed to come. "Cancelled" with no
     * explanation leaves both of them guessing.
     */
    return err(invalidBag('Say why this is being cancelled. The centre and any donors are told.'));
  }

  const owner = await doctorOf(ctx, requestUuid);
  if (owner === undefined) return err(requestNotFound());

  // A doctor cancels their own request. Not a courtesy: the cancellation is
  // recorded against them, and the centre acts on it.
  if (ctx.actor.kind === 'user' && owner !== ctx.actor.userId) {
    return err(requestNotFound());
  }

  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    /* --- 1. the request, guarded on the statuses §3 allows ------------- */
    const outcome = await markRequestCancelled(tx, requestUuid, trimmed, now);
    if (!outcome.moved) {
      return err(requestNotDecidable(outcome.status ?? 'unknown'));
    }

    /* --- 2. units go back on the shelf -------------------------------- */
    /**
     * Only `reserved` ones. A bag that has been `issued` has physically left
     * the fridge and is not the register's to reclaim. That is a return, which
     * is a decision somebody makes with the unit in their hand (§4).
     */
    const released = await tx
      .update(bloodBags)
      .set({ status: 'available', reservedForRequestId: null })
      .where(
        and(
          eq(bloodBags.reservedForRequestId, requestUuid),
          eq(bloodBags.status, 'reserved'),
        ),
      )
      .returning({ id: bloodBags.id });

    /* --- 3. recruitment stops ----------------------------------------- */
    /**
     * The centre sets the status and nothing else. It cannot message a donor,
     * because the donors are the bot's and it knows nothing about the channel.
     * The bot's ticker sees `cancelled` and runs §7.6, which fans out a
     * stand-down to every donor still holding a place.
     */
    const withdrawn = await tx
      .update(donorDemand)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(donorDemand.bloodRequestId, requestUuid),
          inArray(donorDemand.status, ['open', 'fulfilled']),
        ),
      )
      .returning({ id: donorDemand.id });

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'request.cancelled',
      subjectType: 'blood_request',
      subjectId: requestUuid,
      metadata: {
        reason: trimmed,
        cancelledFrom: outcome.from,
        // The bags by id: a unit that was held and released has a gap in its
        // history otherwise, and §4 wants that traceable.
        bagsReleased: released.map((row) => row.id),
        demandsCancelled: withdrawn.map((row) => row.id),
      },
    });

    return ok({
      cancelledFrom: outcome.from,
      bagsReleased: released.length,
      demandsCancelled: withdrawn.length,
    });
  });
}
