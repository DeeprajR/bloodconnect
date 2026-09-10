/**
 * Following one unit of blood end to end (§14, P10).
 *
 * §14 says the correlation id spans request, decision, demand, wave,
 * confirmation, and that one query should be able to follow it. This is the
 * screen that proves it can, and the honest version of that claim has a limit
 * worth stating plainly.
 *
 * **The bot's own event log stays on the bot's side.** `app_web` holds no grant
 * on the `bot` schema, so the fine-grained wave events are not readable from
 * here and never will be from this application. What is readable is the whole
 * chain as the shared contract carries it: the request, the decision, the bags
 * issued against it, the demand raised from the shortfall, and the donors who
 * confirmed. Those are the milestones. The bot's internal steps between them
 * are its business, and the boundary that keeps them there is the same one
 * keeping donor phone numbers out of this application.
 *
 * **Every read here is audited by record id** (§12.2, §14). The trace reaches
 * a request, and a request identifies a patient, so opening one is a read of a
 * clinical record whoever did it must be answerable for.
 */

import { desc, eq, inArray, or, sql } from 'drizzle-orm';
import {
  auditLog,
  bloodRequests,
  centreDecisions,
  decisionBags,
  donorDemand,
  donorDemandConfirmations,
} from '@blood-connect/db';
import { createAuditWriter, type UseCaseContext } from '@blood-connect/platform';
import { formatRequestNumber, parseRequestNumber } from '@blood-connect/domain';

/**
 * A moment in the chain.
 *
 * Deliberately flat and deliberately narrow. `detail` is a sentence built from
 * counts and identifiers; there is no field on this type that could carry a
 * patient's name, and that is the point rather than an accident.
 */
export type TraceStep = {
  readonly at: Date;
  readonly stage:
    | 'request.raised'
    | 'request.patient_attached'
    | 'centre.decided'
    | 'centre.issued'
    | 'demand.raised'
    | 'demand.progress'
    | 'donor.confirmed'
    | 'audit';
  readonly detail: string;
  /** The record this step is about, so the panel can link to it. */
  readonly recordId: string | null;
};

export type Trace = {
  readonly found: boolean;
  /** What the query was resolved to, echoed so a typo is visible. */
  readonly resolved: string | null;
  readonly correlationId: string | null;
  readonly steps: readonly TraceStep[];
  /** Stated on every trace, not only when something is missing. */
  readonly notes: readonly string[];
};

const NOT_FOUND: Trace = {
  found: false,
  resolved: null,
  correlationId: null,
  steps: [],
  notes: [
    'Nothing matched. Try the request number as it appears on the slip, a demand id, or a correlation id from a log line.',
  ],
};

/**
 * Accepts whichever identifier the operator happens to be holding.
 *
 * An incident starts from a log line, a slip somebody read out, or a demand on
 * the board. Making the operator work out which kind they have, and which box
 * to paste it into, is the sort of friction that ends with them not using the
 * screen.
 */
export async function trace(ctx: UseCaseContext, query: string): Promise<Trace> {
  const typed = query.trim();
  if (typed.length === 0) return NOT_FOUND;

  const request = await findRequest(ctx, typed);
  if (request) return buildTrace(ctx, request.id, typed);

  const demand = await findDemandRequest(ctx, typed);
  if (demand) return buildTrace(ctx, demand, typed);

  const byCorrelation = await findByCorrelation(ctx, typed);
  if (byCorrelation) return buildTrace(ctx, byCorrelation, typed, typed);

  return NOT_FOUND;
}

/* -------------------------------------------------------------------------- */

async function findRequest(
  ctx: UseCaseContext,
  typed: string,
): Promise<{ id: string } | null> {
  // Tolerant of how it was transcribed, strict about its length: a five-digit
  // sequence read as four is a different request, not a near miss.
  const parsed = parseRequestNumber(typed);
  if (parsed) {
    const [row] = await ctx.db
      .select({ id: bloodRequests.id })
      .from(bloodRequests)
      .where(eq(bloodRequests.requestId, formatRequestNumber(parsed.day, parsed.sequence)));
    if (row) return row;
  }

  /*
   * The number exactly as stored, for anything the parser does not recognise.
   *
   * ADR 0010 changed the format from `BR-YYYY-NNNNNN` to `DDMMYY-NNNNN`, and
   * the rows raised before that keep their old ids. An operator reading a
   * historical record has whichever one was printed at the time, and a panel
   * that only understood today's format would refuse the older half of the
   * archive.
   */
  const [byNumber] = await ctx.db
    .select({ id: bloodRequests.id })
    .from(bloodRequests)
    .where(eq(bloodRequests.requestId, typed));
  if (byNumber) return byNumber;

  if (!isUuid(typed)) return null;
  const [row] = await ctx.db
    .select({ id: bloodRequests.id })
    .from(bloodRequests)
    .where(eq(bloodRequests.id, typed));
  return row ?? null;
}

/** A demand id resolves to the request it was raised for, so both are shown. */
async function findDemandRequest(ctx: UseCaseContext, typed: string): Promise<string | null> {
  if (!isUuid(typed)) return null;

  const [row] = await ctx.db
    .select({ requestId: donorDemand.bloodRequestId, id: donorDemand.id })
    .from(donorDemand)
    .where(eq(donorDemand.id, typed));

  if (!row) return null;
  /*
   * A `stock_floor` demand answers no request at all (§4), so there is no chain
   * above it. Returning its own id keeps the trace anchored to something real
   * rather than reporting nothing found for a demand that plainly exists.
   */
  return row.requestId ?? row.id;
}

async function findByCorrelation(ctx: UseCaseContext, typed: string): Promise<string | null> {
  const [row] = await ctx.db
    .select({ subjectId: auditLog.subjectId })
    .from(auditLog)
    .where(eq(auditLog.correlationId, typed))
    .orderBy(auditLog.occurredAt)
    .limit(1);
  return row?.subjectId ?? null;
}

async function buildTrace(
  ctx: UseCaseContext,
  requestUuid: string,
  resolved: string,
  correlationId: string | null = null,
): Promise<Trace> {
  const steps: TraceStep[] = [];
  const notes: string[] = [];

  const [request] = await ctx.db
    .select({
      id: bloodRequests.id,
      requestId: bloodRequests.requestId,
      status: bloodRequests.status,
      urgency: bloodRequests.urgency,
      bloodGroup: bloodRequests.bloodGroup,
      product: bloodRequests.product,
      units: bloodRequests.units,
      submittedAt: bloodRequests.submittedAt,
      createdAt: bloodRequests.createdAt,
      admissionId: bloodRequests.admissionId,
      updatedAt: bloodRequests.updatedAt,
    })
    .from(bloodRequests)
    .where(eq(bloodRequests.id, requestUuid));

  if (request) {
    steps.push({
      at: request.submittedAt ?? request.createdAt,
      stage: 'request.raised',
      // Group, product, units and urgency. Not who it is for: §11.9 keeps the
      // patient out of anything an operations screen renders.
      detail: `${request.requestId ?? 'no number'}: ${String(request.units)} × ${request.bloodGroup ?? '?'} ${request.product ?? ''}, ${request.urgency ?? 'urgency not recorded'}`,
      recordId: request.id,
    });

    if (request.admissionId !== null) {
      steps.push({
        at: request.updatedAt,
        stage: 'request.patient_attached',
        detail: 'The counter identified the patient and attached the admission.',
        recordId: request.id,
      });
    } else {
      notes.push('No patient is attached to this request yet (ADR 0010).');
    }
  } else {
    notes.push('No blood request matched, so this trace starts at the demand.');
  }

  const decisions = await ctx.db
    .select({
      id: centreDecisions.id,
      decidedAt: centreDecisions.decidedAt,
      decision: centreDecisions.decision,
      unitsIssued: centreDecisions.unitsIssued,
    })
    .from(centreDecisions)
    .where(eq(centreDecisions.requestId, requestUuid))
    .orderBy(centreDecisions.decidedAt);

  for (const decision of decisions) {
    steps.push({
      at: decision.decidedAt,
      stage: 'centre.decided',
      detail: `${decision.decision}, ${String(decision.unitsIssued)} unit(s)`,
      recordId: decision.id,
    });
  }

  if (decisions.length > 0) {
    const bags = await ctx.db
      .select({ decisionId: decisionBags.decisionId, bagId: decisionBags.bagId })
      .from(decisionBags)
      .where(
        inArray(
          decisionBags.decisionId,
          decisions.map((decision) => decision.id),
        ),
      );

    if (bags.length > 0) {
      const at = decisions[decisions.length - 1]?.decidedAt ?? ctx.clock.now();
      steps.push({
        at,
        stage: 'centre.issued',
        detail: `${String(bags.length)} bag(s) tied to the decision`,
        recordId: bags[0]?.bagId ?? null,
      });
    }
  }

  const demands = await ctx.db
    .select({
      id: donorDemand.id,
      createdAt: donorDemand.createdAt,
      updatedAt: donorDemand.updatedAt,
      trigger: donorDemand.trigger,
      status: donorDemand.status,
      units: donorDemand.units,
      donorsNotified: donorDemand.donorsNotified,
      confirmedUnits: donorDemand.confirmedUnits,
      completedUnits: donorDemand.completedUnits,
      botPublicId: donorDemand.botPublicId,
      importedAt: donorDemand.importedAt,
    })
    .from(donorDemand)
    .where(or(eq(donorDemand.bloodRequestId, requestUuid), eq(donorDemand.id, requestUuid)));

  for (const demand of demands) {
    steps.push({
      at: demand.createdAt,
      stage: 'demand.raised',
      detail: `${demand.trigger}, ${String(demand.units)} unit(s), now ${demand.status}`,
      recordId: demand.id,
    });

    if (demand.importedAt !== null) {
      steps.push({
        at: demand.importedAt,
        stage: 'demand.progress',
        // The wave itself happened inside the bot. What crossed the boundary
        // is these three counters, and they are what the panel can show.
        detail: `Picked up by the bot as ${demand.botPublicId ?? 'an unnamed demand'}. ${String(demand.donorsNotified)} donor(s) messaged, ${String(demand.confirmedUnits)} unit(s) confirmed, ${String(demand.completedUnits)} collected.`,
        recordId: demand.id,
      });
    } else {
      notes.push(
        'The bot has not picked this demand up yet, so nobody has been contacted for it.',
      );
    }

    const confirmations = await ctx.db
      .select({
        id: donorDemandConfirmations.id,
        confirmedAt: donorDemandConfirmations.confirmedAt,
        status: donorDemandConfirmations.status,
      })
      .from(donorDemandConfirmations)
      .where(eq(donorDemandConfirmations.demandId, demand.id))
      .orderBy(donorDemandConfirmations.confirmedAt);

    for (const confirmation of confirmations) {
      steps.push({
        at: confirmation.confirmedAt,
        stage: 'donor.confirmed',
        // A roster row id, never a donor id and never a name. The panel has no
        // way to resolve a donor and no business doing so (§6, §11.9).
        detail: `A donor said yes. Where that got to: ${confirmation.status}.`,
        recordId: confirmation.id,
      });
    }
  }

  const trail = await ctx.db
    .select({
      id: auditLog.id,
      occurredAt: auditLog.occurredAt,
      action: auditLog.action,
      correlationId: auditLog.correlationId,
      subjectId: auditLog.subjectId,
    })
    .from(auditLog)
    .where(
      or(
        eq(auditLog.subjectId, requestUuid),
        correlationId === null ? undefined : eq(auditLog.correlationId, correlationId),
      ),
    )
    .orderBy(desc(auditLog.occurredAt))
    .limit(50);

  for (const entry of trail) {
    steps.push({
      at: entry.occurredAt,
      stage: 'audit',
      detail: entry.action,
      recordId: entry.subjectId,
    });
  }

  notes.push(
    'The bot’s own event log is not readable from this application by design (§5.1). The milestones above are what the shared tables carry.',
  );

  /*
   * Reading a trace is reading a clinical record, so it is audited like one.
   *
   * In its own transaction because the writer takes a transaction handle: an
   * audit row has to commit with the thing it records, and here the thing it
   * records is the read itself.
   */
  await ctx.db.transaction(async (tx) => {
    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, ctx.clock.now());
    await audit({
      action: 'ops.trace_read',
      subjectType: 'blood_request',
      subjectId: requestUuid,
      metadata: { resolved },
    });
  });

  return {
    found: steps.length > 0,
    resolved,
    correlationId: correlationId ?? trail[0]?.correlationId ?? null,
    steps: steps.sort((a, b) => a.at.getTime() - b.at.getTime()),
    notes,
  };
}

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export const _internals = { isUuid, sql };
