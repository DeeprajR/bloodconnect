/**
 * Deciding a request — the whole decision is one transaction (§7.2).
 *
 * Five things happen here, and they must be the same five or none:
 *
 *   1. Claim the oldest available bags of the group, skipping any another
 *      counter is already holding.
 *   2. If there is a shortfall **and** the product recruits donors, raise the
 *      demand for the difference.
 *   3. Insert the decision, `demand_id` included. The unique constraint on
 *      `request_id` is what stops a request being answered twice.
 *   4. Reserve exactly the bags claimed in (1), and record which ones.
 *   5. Move the request to its decided status.
 *
 * **The claim comes first and writes nothing.** It takes row locks only, so the
 * constraint in (3) is tested before a single bag is marked reserved — and the
 * loser of a race rolls back having reserved nothing, rather than stranding
 * units as `reserved` for a decision that never existed.
 *
 * **The demand and the decision sharing a transaction is why a shortfall can
 * never exist without its demand row.** That is the whole point of the pairing:
 * an answer of "we could only give you two of the four" with nobody recruited
 * for the other two is a silent failure nobody notices until the patient needs
 * the blood.
 *
 * §7.2 writes the demand last, after the decision. It is raised before it here
 * because `centre_decisions` is append-only by grant, so the row has to be
 * complete when it is inserted. The atomicity the section is actually about is
 * unchanged — see the comment on step 2.
 *
 * `SKIP LOCKED` is why two staff deciding two *different* requests for the same
 * group never contend: each takes the rows the other has not locked, rather
 * than queueing behind it (§4).
 */

import { inArray, sql } from 'drizzle-orm';
import { err, ok, type Result } from '@blood-connect/result';
import { bloodBags, centreDecisions, decisionBags } from '@blood-connect/db';
import {
  mayDecideWithoutPatient,
  recruitsDonors,
  type BloodGroup,
  type Product,
  type Urgency,
} from '@blood-connect/domain';
import { getRequestForDecision, markRequestDecided } from '@blood-connect/hospital';
import {
  actorHas,
  createAuditWriter,
  type Transaction,
  type UseCaseContext,
} from '@blood-connect/platform';

import {
  notAuthorized,
  requestAlreadyDecided,
  patientNotIdentified,
  requestNotDecidable,
  requestNotFound,
  type DecideError,
} from '../errors.js';
import { raiseDemand, readCentreSnapshot } from './demand.js';

export type DecisionAction = 'issue' | 'decline';

export type DecisionInput = {
  readonly requestUuid: string;
  /**
   * `issue` fills the request from the shelf and takes whatever is there.
   * `decline` answers it without issuing anything — a duplicate request, or one
   * the centre is refusing on its merits.
   */
  readonly action: DecisionAction;
  readonly note: string | null;
};

export type DecisionResult = {
  readonly decisionId: string;
  readonly decision: 'approved' | 'partial' | 'declined';
  readonly unitsIssued: number;
  readonly unitsRequested: number;
  readonly bagIds: readonly string[];
  readonly demandId: string | null;
  readonly demandUnits: number;
};

/** Postgres unique violation. */
const UNIQUE_VIOLATION = '23505';

/** The index that carries the one-decision-per-request rule. */
const DECISION_CONSTRAINT = 'centre_decisions_request_idx';

/**
 * Was this the constraint firing, or a real fault?
 *
 * Deliberately narrow. Only a unique violation on *that* index means somebody
 * got there first; every other unique violation is a bug, and swallowing it as
 * "already decided" would turn a broken write into a reassuring message.
 *
 * The chain walk is not defensive padding: the driver's error arrives wrapped
 * in a query error, so reading only the top level finds nothing and the race is
 * reported as a crash. That is exactly what happened the first time this ran.
 */
function isDecisionRaceLoss(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    if (typeof current !== 'object') return false;
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (
      candidate.code === UNIQUE_VIOLATION &&
      candidate.constraint_name === DECISION_CONSTRAINT
    ) {
      return true;
    }
    current = candidate.cause;
  }

  return false;
}

/**
 * Step 1 of §7.2, written as SQL rather than through the query builder.
 *
 * This statement is the phase. Three things in it are load-bearing and none of
 * them survive a "simplification":
 *
 *  - `status = 'available'` matched against the partial index, so this is an
 *    index scan of the shortest-dated units rather than a scan of every bag the
 *    centre has ever held.
 *  - `ORDER BY expires_at` issues the unit closest to expiry first, which is
 *    how a centre avoids throwing blood away.
 *  - `FOR UPDATE SKIP LOCKED` means a second counter deciding a different
 *    request for the same group takes the *next* bags instead of blocking. A
 *    plain `FOR UPDATE` would serialise the whole counter behind one decision.
 *
 * Exact group match, never a compatible one: substituting a compatible group is
 * a clinical judgement a person makes, not one this system takes silently (§2.7).
 */
async function claimBags(
  tx: Transaction,
  bloodGroup: BloodGroup,
  product: Product,
  units: number,
): Promise<string[]> {
  if (units < 1) return [];

  const result = await tx.execute(sql`
    SELECT id
      FROM hospital.blood_bags
     WHERE blood_group = ${bloodGroup}
       AND product = ${product}
       AND status = 'available'
     ORDER BY expires_at ASC, id ASC
     LIMIT ${units}
       FOR UPDATE SKIP LOCKED
  `);

  // postgres-js returns the rows directly; other drivers wrap them in `.rows`.
  const rows: readonly Record<string, unknown>[] = Array.isArray(result)
    ? result
    : ((result as { rows?: Record<string, unknown>[] }).rows ?? []);

  return rows.map((row) => String(row['id']));
}

/** Thrown to roll the transaction back; never escapes this module. */
class DecisionRaceLost extends Error {
  constructor() {
    super('the request was decided or withdrawn by someone else');
    this.name = 'DecisionRaceLost';
  }
}

export async function decideRequest(
  ctx: UseCaseContext,
  input: DecisionInput,
): Promise<Result<DecisionResult, DecideError>> {
  if (!actorHas(ctx.actor, 'centre:operate')) return err(notAuthorized('centre:operate'));

  const request = await getRequestForDecision(ctx, input.requestUuid);
  if (!request) return err(requestNotFound());
  if (request.status !== 'submitted') return err(requestNotDecidable(request.status));

  /**
   * Nobody has said who this is for (§4, ADR 0010).
   *
   * A unit leaving the fridge has to be traceable to a named person, and this is
   * where that becomes a refusal rather than a convention. **Emergency is the
   * only exception**: waiting for a bystander to arrive before releasing units
   * in a real emergency is the worse failure, and the decision records that it
   * was made against an unidentified patient.
   *
   * Checked before the transaction opens, because there is nothing to roll back
   * — and a refusal that costs a lock is a refusal that slows the counter down
   * for no reason.
   */
  if (request.awaitingPatient && !mayDecideWithoutPatient(request.urgency as Urgency)) {
    return err(patientNotIdentified());
  }

  const now = ctx.clock.now();
  const decisionId = ctx.ids.next<'DecisionId'>();

  try {
    return await ctx.db.transaction(async (tx) => {
      /* --- 1. claim, oldest expiry first, skipping what others hold ------- */
      const bagIds =
        input.action === 'issue'
          ? await claimBags(tx, request.bloodGroup, request.product, request.units)
          : [];

      const unitsIssued = bagIds.length;
      const shortfall = request.units - unitsIssued;
      const decision =
        unitsIssued === 0 ? 'declined' : shortfall === 0 ? 'approved' : 'partial';

      /* --- 2. the shortfall becomes demand, before the decision is written */
      /**
       * §7.2 lists the demand last. It is raised here instead, and the reason
       * is that `centre_decisions` is append-only: `app_web` holds no UPDATE on
       * it (migration 0010), because a decision is a clinical record of what
       * the centre answered and is corrected by a later action, never by
       * rewriting the row.
       *
       * So the decision row has to be complete when it is inserted, `demand_id`
       * included — which means the demand exists first. Same transaction, so
       * the guarantee §7.2 is actually about is untouched: a shortfall cannot
       * exist without its demand row, and the loser of a decision race rolls
       * back the demand along with everything else.
       *
       * The first version of this updated the decision afterwards. The grant
       * refused it, which is exactly what the grant is for.
       */
      const wantsDemand =
        shortfall > 0 && input.action === 'issue' && recruitsDonors(request.product);

      let demandId: string | null = null;
      if (wantsDemand) {
        const snapshot = await readCentreSnapshot(tx);
        // A demand with no district tells somebody to come and give blood
        // without saying where. Refuse the whole decision rather than commit an
        // answer that quietly recruits nobody.
        if (!snapshot.ok) return err(snapshot.error);

        demandId =
          (await raiseDemand(tx, snapshot.value, ctx.ids, {
            trigger: 'request_shortfall',
            bloodRequestId: request.id,
            bloodGroup: request.bloodGroup,
            product: request.product,
            units: shortfall,
            dateRequired: request.dateRequired,
            notes: `Shortfall on ${request.requestId}: ${unitsIssued} of ${request.units} issued.`,
          })) ?? null;
      }

      /* --- 3. the constraint that stops a second decision ----------------- */
      await tx.insert(centreDecisions).values({
        id: decisionId,
        requestId: request.id,
        decision,
        unitsIssued,
        unitsRequested: request.units,
        note: input.note,
        decidedBy: ctx.actor.kind === 'user' ? ctx.actor.userId : null,
        decidedAt: now,
        // The exception, recorded on the decision that took it (ADR 0010).
        patientUnidentified: request.awaitingPatient,
        demandId,
      });

      /* --- 4. reserve exactly the bags claimed in (1) --------------------- */
      if (bagIds.length > 0) {
        await tx
          .update(bloodBags)
          .set({ status: 'reserved', reservedForRequestId: request.id })
          .where(inArray(bloodBags.id, bagIds));

        await tx
          .insert(decisionBags)
          .values(bagIds.map((bagId) => ({ decisionId, bagId })));
      }

      /* --- 5. the request moves to its answer ----------------------------- */
      const moved = await markRequestDecided(
        tx,
        request.id,
        decision === 'approved'
          ? 'approved'
          : decision === 'partial'
            ? 'partially_approved'
            : 'declined',
      );
      if (!moved) {
        // The request left `submitted` between the read above and this update —
        // a cancellation, almost always. Nothing here may stand.
        throw new DecisionRaceLost();
      }

      const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
      await audit({
        action: 'request.decided',
        subjectType: 'blood_request',
        subjectId: request.id,
        metadata: {
          requestId: request.requestId,
          patientUnidentified: request.awaitingPatient,
          decision,
          unitsIssued,
          unitsRequested: request.units,
          // The bags by id: "which unit went to which patient" is a question a
          // transfusion service has to be able to answer years later (§4).
          bagIds,
          demandId,
        },
      });

      return ok({
        decisionId,
        decision,
        unitsIssued,
        unitsRequested: request.units,
        bagIds,
        demandId,
        demandUnits: demandId === null ? 0 : shortfall,
      });
    });
  } catch (error) {
    // The loser of the race, and the only place the constraint is turned into a
    // value. Everything it attempted rolled back, including the bag claims.
    if (error instanceof DecisionRaceLost) return err(requestAlreadyDecided());
    if (isDecisionRaceLoss(error)) return err(requestAlreadyDecided());
    throw error;
  }
}
