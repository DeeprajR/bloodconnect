/**
 * A presented tag, and the three things it can mean (§4, §7.5).
 *
 * §4 is emphatic that a tag which already exists **is not one situation, it is
 * three, and they must not share a button**. The screen resolves the tag, shows
 * everything known about the bag currently on it, and offers only the actions
 * valid for that status.
 *
 * ```
 *  register says      what happened                    the workflow
 *  ─────────────────────────────────────────────────────────────────────
 *  issued / reserved  case 1 — the bag came back       Return
 *  terminal           case 2 — the tag was reused      Release, then re-register
 *  available          neither. something is wrong      Blocked — a discrepancy
 * ```
 *
 * The classification is pure and lives in `classifyTag`, so the three cases can
 * be tested without a database and cannot drift from the screen that renders
 * them.
 *
 * **Case 3 has no resolution on this transaction, by design.** The register
 * believing a bag is on the shelf while somebody holds its tag means the
 * register is stale, two bags carry the same tag, or the tag is cloned — and
 * every one of those can put the wrong unit into a patient. §4 and §14 both say
 * the right behaviour is to stop and make a person go and look. The pressure to
 * add a "register it anyway" button will come from busy staff, and the answer is
 * no.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import { err, ok, type Result } from '@blood-connect/result';
import {
  bloodBags,
  rfidTags,
  tagAssignments,
  tagDiscrepancies,
} from '@blood-connect/db';
import type { BagStatus } from '@blood-connect/domain';
import { actorHas, createAuditWriter, type UseCaseContext } from '@blood-connect/platform';

import {
  invalidBag,
  notAuthorized,
  tagUnavailable,
  type InvalidBag,
  type NotAuthorized,
  type TagUnavailable,
} from '../errors.js';

/* -------------------------------------------------------------------------- */
/* The classification, pure                                                    */
/* -------------------------------------------------------------------------- */

export type TagResolution =
  /** Nothing on it. The intake form opens (§4). */
  | { readonly kind: 'unassigned' }
  /** Case 1: the unit has come back into the centre's custody. */
  | { readonly kind: 'return'; readonly bagId: string; readonly bagStatus: BagStatus }
  /** Case 2: the tag was harvested off a spent bag and put on a new one. */
  | { readonly kind: 'reuse'; readonly bagId: string; readonly bagStatus: BagStatus }
  /** Case 3: the register thinks that bag is on the shelf. Stop. */
  | { readonly kind: 'blocked'; readonly bagId: string }
  /** Damaged or unreliable. It can never carry a bag again (§4). */
  | { readonly kind: 'retired' };

/** Statuses that mean the bag is gone for good, so the tag may be released. */
const TERMINAL: readonly BagStatus[] = ['discarded', 'expired', 'lost', 'returned'];

/**
 * Which of §4's cases this is, from the register alone.
 *
 * Pure and total: every combination of tag status and bag status lands in
 * exactly one case, which is what makes the screen's "offer only the valid
 * actions" rule implementable rather than aspirational.
 */
export function classifyTag(
  tag: { status: string; currentBagId: string | null } | undefined,
  bagStatus: BagStatus | undefined,
): TagResolution {
  if (tag === undefined || tag.status === 'unassigned') return { kind: 'unassigned' };
  if (tag.status === 'retired') return { kind: 'retired' };
  if (tag.currentBagId === null || bagStatus === undefined) return { kind: 'unassigned' };

  // The register says it is on the shelf right now. Neither case 1 nor case 2.
  if (bagStatus === 'available' || bagStatus === 'quarantined') {
    return { kind: 'blocked', bagId: tag.currentBagId };
  }

  // Gone for good: the tag outlived the bag and is on something new.
  if (TERMINAL.includes(bagStatus)) {
    return { kind: 'reuse', bagId: tag.currentBagId, bagStatus };
  }

  // `issued` or `reserved` — the unit is out, and it has come back.
  return { kind: 'return', bagId: tag.currentBagId, bagStatus };
}

/* -------------------------------------------------------------------------- */
/* Resolving a scan                                                            */
/* -------------------------------------------------------------------------- */

export type ResolvedTag = {
  readonly tagUid: string;
  readonly resolution: TagResolution;
  readonly bag:
    | {
        readonly id: string;
        readonly unitNumber: string;
        readonly bloodGroup: string;
        readonly product: string;
        readonly collectedAt: string;
        readonly expiresAt: string;
        readonly status: string;
        readonly issuedToRequestId: string | null;
        readonly issuedAt: Date | null;
      }
    | undefined;
  /** An open case-3 discrepancy on this tag, if one is already raised. */
  readonly openDiscrepancyId: string | undefined;
};

/**
 * What the screen shows when a tag is presented.
 *
 * §4: it "shows everything known about the bag currently on it — group,
 * product, collection, expiry, status, and if issued, to which request and
 * when". A screen that says only "tag in use" makes somebody guess which of
 * three very different things happened.
 */
export async function resolveTag(
  ctx: UseCaseContext,
  tagUid: string,
): Promise<Result<ResolvedTag, NotAuthorized>> {
  if (!actorHas(ctx.actor, 'centre:operate')) return err(notAuthorized('centre:operate'));

  const uid = tagUid.trim();

  const [tag] = await ctx.db
    .select({ status: rfidTags.status, currentBagId: rfidTags.currentBagId })
    .from(rfidTags)
    .where(eq(rfidTags.tagUid, uid));

  const bagId = tag?.currentBagId ?? null;
  const [bag] = bagId
    ? await ctx.db
        .select({
          id: bloodBags.id,
          unitNumber: bloodBags.unitNumber,
          bloodGroup: bloodBags.bloodGroup,
          product: bloodBags.product,
          collectedAt: bloodBags.collectedAt,
          expiresAt: bloodBags.expiresAt,
          status: bloodBags.status,
          issuedToRequestId: bloodBags.issuedToRequestId,
          issuedAt: bloodBags.issuedAt,
        })
        .from(bloodBags)
        .where(eq(bloodBags.id, bagId))
    : [];

  const [open] = await ctx.db
    .select({ id: tagDiscrepancies.id })
    .from(tagDiscrepancies)
    .where(and(eq(tagDiscrepancies.tagUid, uid), eq(tagDiscrepancies.status, 'open')));

  return ok({
    tagUid: uid,
    resolution: classifyTag(tag, bag?.status as BagStatus | undefined),
    bag,
    openDiscrepancyId: open?.id,
  });
}

/* -------------------------------------------------------------------------- */
/* Case 2 — release, so the tag can be re-registered                           */
/* -------------------------------------------------------------------------- */

/**
 * Un-registers a tag from a bag that is gone for good (§4).
 *
 * **Only offered when the assigned bag is terminal**, and separate from
 * re-registering on purpose: "a single reassign button invites someone to race
 * past the question of what happened to the previous bag". Re-registering then
 * goes through the whole intake form, producing a **new** bag with its own
 * collection date and its own derived expiry — the old bag's history stays
 * exactly as it was.
 */
export async function releaseTag(
  ctx: UseCaseContext,
  tagUid: string,
  reason: string,
  options: { retire?: boolean } = {},
): Promise<Result<{ released: boolean }, NotAuthorized | InvalidBag | TagUnavailable>> {
  if (!actorHas(ctx.actor, 'centre:operate')) return err(notAuthorized('centre:operate'));

  const uid = tagUid.trim();
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    return err(invalidBag('Say why the tag is being released. It is recorded against you.'));
  }

  const now = ctx.clock.now();
  const actorId = ctx.actor.kind === 'user' ? ctx.actor.userId : null;

  return ctx.db.transaction(async (tx) => {
    // Serialise on the tag, as every scan path does (§7.5).
    const [tag] = await tx
      .select({ status: rfidTags.status, currentBagId: rfidTags.currentBagId })
      .from(rfidTags)
      .where(eq(rfidTags.tagUid, uid))
      .for('update');

    if (!tag) return err(invalidBag('That tag is not registered.'));
    if (tag.status === 'retired') return err(tagUnavailable('retired'));
    if (tag.status !== 'assigned' || tag.currentBagId === null) {
      return err(invalidBag('That tag is not carrying a bag.'));
    }

    const [bag] = await tx
      .select({ status: bloodBags.status })
      .from(bloodBags)
      .where(eq(bloodBags.id, tag.currentBagId));

    const status = (bag?.status ?? 'available') as BagStatus;
    const decision = classifyTag(tag, status);

    // Releasing a tag whose bag is live would strand a unit nobody can find,
    // and releasing one the register thinks is on the shelf is case 3.
    if (decision.kind === 'return') return err(tagUnavailable('bag_live'));
    if (decision.kind === 'blocked') return err(tagUnavailable('register_conflict'));

    await tx
      .update(tagAssignments)
      .set({ releasedAt: now, releasedBy: actorId, releaseReason: trimmed })
      .where(and(eq(tagAssignments.tagUid, uid), isNull(tagAssignments.releasedAt)));

    await tx
      .update(rfidTags)
      .set(
        options.retire === true
          ? {
              status: 'retired',
              currentBagId: null,
              retiredAt: now,
              retireReason: trimmed,
            }
          : { status: 'unassigned', currentBagId: null },
      )
      .where(eq(rfidTags.tagUid, uid));

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: options.retire === true ? 'tag.retired' : 'tag.released',
      subjectType: 'rfid_tag',
      subjectId: uid,
      metadata: { reason: trimmed, bagId: tag.currentBagId, bagStatus: status },
    });

    return ok({ released: true });
  });
}

/* -------------------------------------------------------------------------- */
/* Case 3 — the discrepancy                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Raises a case-3 discrepancy and stops (§7.5).
 *
 * No resolution is offered here. The row names the conflicting bag so somebody
 * can physically go and find it, and it sits on the centre overview until a
 * person closes it — it never auto-resolves and never expires.
 */
export async function raiseTagDiscrepancy(
  ctx: UseCaseContext,
  tagUid: string,
  note: string,
): Promise<Result<{ discrepancyId: string; alreadyOpen: boolean }, NotAuthorized | InvalidBag>> {
  if (!actorHas(ctx.actor, 'centre:operate')) return err(notAuthorized('centre:operate'));

  const uid = tagUid.trim();
  const now = ctx.clock.now();
  const actorId = ctx.actor.kind === 'user' ? ctx.actor.userId : null;
  const discrepancyId = ctx.ids.next<'DiscrepancyId'>();

  return ctx.db.transaction(async (tx) => {
    const [tag] = await tx
      .select({ status: rfidTags.status, currentBagId: rfidTags.currentBagId })
      .from(rfidTags)
      .where(eq(rfidTags.tagUid, uid))
      .for('update');

    if (!tag?.currentBagId) return err(invalidBag('That tag is not carrying a bag.'));

    // Raising a second one for the same tag would split the investigation in
    // two, and the first is already on somebody's list.
    const [existing] = await tx
      .select({ id: tagDiscrepancies.id })
      .from(tagDiscrepancies)
      .where(and(eq(tagDiscrepancies.tagUid, uid), eq(tagDiscrepancies.status, 'open')));

    if (existing) return ok({ discrepancyId: existing.id, alreadyOpen: true });

    await tx.insert(tagDiscrepancies).values({
      id: discrepancyId,
      tagUid: uid,
      presentedAt: now,
      presentedBy: actorId,
      conflictingBagId: tag.currentBagId,
      status: 'open',
      note: note.trim() || null,
    });

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'tag.discrepancy_raised',
      subjectType: 'tag_discrepancy',
      subjectId: discrepancyId,
      metadata: { tagUid: uid, conflictingBagId: tag.currentBagId },
    });

    return ok({ discrepancyId, alreadyOpen: false });
  });
}

export type DiscrepancyFinding = 'duplicate_tag' | 'bag_missing' | 'mis_scan';

export type DiscrepancyOutcome = {
  readonly finding: DiscrepancyFinding;
  readonly tagRetired: boolean;
  readonly conflictingBagStatus: string | null;
};

/**
 * Closes a discrepancy, exactly three ways (§4).
 *
 * Three findings, three fixed actions, and each requires the resolver's identity
 * and a note — the database refuses a row closed without all three.
 *
 * | What they found | What happens |
 * |---|---|
 * | The conflicting bag **is on the shelf** — so the presented one wears a duplicate or cloned tag | The tag in hand is **retired** and can never carry a bag again |
 * | The conflicting bag **is not there** — it left without being scanned out | It is marked `lost`, which is a discard for stock purposes and a reportable event. The tag is released and can be re-registered |
 * | **A mis-scan** — wrong tag presented, or a mistaken intake | Dismissed. Nothing changes |
 *
 * The presented bag is *not* registered by any of these. Re-registering it goes
 * through normal intake afterwards, on a fresh tag where the tag was retired.
 */
export async function resolveTagDiscrepancy(
  ctx: UseCaseContext,
  discrepancyId: string,
  finding: DiscrepancyFinding,
  note: string,
): Promise<Result<DiscrepancyOutcome, NotAuthorized | InvalidBag>> {
  if (!actorHas(ctx.actor, 'centre:operate')) return err(notAuthorized('centre:operate'));

  const trimmed = note.trim();
  if (trimmed.length === 0) {
    // §4: "each requiring the resolver's identity and a note". A row closed
    // without one records that somebody made it go away, not what they found.
    return err(invalidBag('Say what you found. It is the record of the investigation.'));
  }

  const now = ctx.clock.now();
  const actorId = ctx.actor.kind === 'user' ? ctx.actor.userId : null;
  if (actorId === null) {
    return err(invalidBag('A discrepancy is closed by a named person, never by a job.'));
  }

  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(tagDiscrepancies)
      .where(eq(tagDiscrepancies.id, discrepancyId))
      .for('update');

    if (!row) return err(invalidBag('That discrepancy no longer exists.'));
    if (row.status !== 'open') return err(invalidBag('That discrepancy is already closed.'));

    let tagRetired = false;
    let conflictingBagStatus: string | null = null;

    if (finding === 'duplicate_tag') {
      // The conflicting bag is genuinely on the shelf, so this tag is a
      // duplicate or a clone. It never carries a bag again.
      await tx
        .update(tagAssignments)
        .set({ releasedAt: now, releasedBy: actorId, releaseReason: 'Duplicate or cloned tag' })
        .where(and(eq(tagAssignments.tagUid, row.tagUid), isNull(tagAssignments.releasedAt)));

      await tx
        .update(rfidTags)
        .set({
          status: 'retired',
          currentBagId: null,
          retiredAt: now,
          retireReason: 'Duplicate or cloned tag',
        })
        .where(eq(rfidTags.tagUid, row.tagUid));

      tagRetired = true;
    }

    if (finding === 'bag_missing') {
      /**
       * The register was wrong: the unit left without being scanned out.
       *
       * `lost` is a discard for stock purposes and a reportable event for the
       * centre (§4). It is deliberately not `discarded` — nobody knows where
       * this unit went, and recording a disposal route for it would be a
       * fiction.
       */
      await tx
        .update(bloodBags)
        .set({ status: 'lost' })
        .where(eq(bloodBags.id, row.conflictingBagId));
      conflictingBagStatus = 'lost';

      await tx
        .update(tagAssignments)
        .set({ releasedAt: now, releasedBy: actorId, releaseReason: 'Bag missing from the shelf' })
        .where(and(eq(tagAssignments.tagUid, row.tagUid), isNull(tagAssignments.releasedAt)));

      await tx
        .update(rfidTags)
        .set({ status: 'unassigned', currentBagId: null })
        .where(eq(rfidTags.tagUid, row.tagUid));
    }

    // `mis_scan` changes nothing at all, which is the whole of that outcome.

    await tx
      .update(tagDiscrepancies)
      .set({
        status: 'resolved',
        finding,
        note: trimmed,
        resolvedBy: actorId,
        resolvedAt: now,
      })
      .where(and(eq(tagDiscrepancies.id, discrepancyId), eq(tagDiscrepancies.status, 'open')));

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'tag.discrepancy_resolved',
      subjectType: 'tag_discrepancy',
      subjectId: discrepancyId,
      metadata: {
        finding,
        tagUid: row.tagUid,
        conflictingBagId: row.conflictingBagId,
        tagRetired,
        conflictingBagStatus,
      },
    });

    return ok({ finding, tagRetired, conflictingBagStatus });
  });
}

export type DiscrepancyRow = {
  readonly id: string;
  readonly tagUid: string;
  readonly presentedAt: Date;
  readonly conflictingBagId: string;
  readonly conflictingUnitNumber: string;
  readonly conflictingStatus: string;
  readonly note: string | null;
};

/**
 * Open discrepancies, oldest first.
 *
 * **No job filters, ages out or closes these.** §4 calls this "the one alarm in
 * this module worth being loud", and a list that quietly shortened itself would
 * be the opposite.
 */
export async function listOpenDiscrepancies(
  ctx: UseCaseContext,
): Promise<DiscrepancyRow[]> {
  return ctx.db
    .select({
      id: tagDiscrepancies.id,
      tagUid: tagDiscrepancies.tagUid,
      presentedAt: tagDiscrepancies.presentedAt,
      conflictingBagId: tagDiscrepancies.conflictingBagId,
      conflictingUnitNumber: bloodBags.unitNumber,
      conflictingStatus: bloodBags.status,
      note: tagDiscrepancies.note,
    })
    .from(tagDiscrepancies)
    .innerJoin(bloodBags, eq(bloodBags.id, tagDiscrepancies.conflictingBagId))
    .where(eq(tagDiscrepancies.status, 'open'))
    .orderBy(sql`${tagDiscrepancies.presentedAt} ASC`);
}
