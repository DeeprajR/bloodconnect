/**
 * Bag intake — typed entry (§4, §10).
 *
 * The reader is not here yet and may never arrive, so this is the keyboard
 * path: the operator types the unit number and, optionally, the tag identifier.
 * §10 requires that path regardless of hardware, which is why it is built first
 * rather than as a fallback bolted on afterwards — when a barcode reader does
 * arrive it presents as a keyboard and fills the same field.
 *
 * Two rules the form cannot be talked out of:
 *
 *  - **The expiry clock runs from collection**, never from intake or a re-scan.
 *    A bag does not become fresher by being handled.
 *  - **A printed label wins, and a mismatch is flagged rather than blocked**
 *    (§4). The operator has the bag in their hand; the system does not. What it
 *    can do is record which claim the stored date is, and say when the two
 *    disagree.
 */

import { eq, sql } from 'drizzle-orm';
import { err, ok, type Result } from '@blood-connect/result';
import { bloodBags, productShelfLives, rfidTags, tagAssignments } from '@blood-connect/db';
import {
  deriveExpiry,
  isBloodGroup,
  isProduct,
  parseCalendarDay,
  type BloodGroup,
  type Product,
} from '@blood-connect/domain';
import {
  actorHas,
  createAuditWriter,
  type Transaction,
  type UseCaseContext,
} from '@blood-connect/platform';

import {
  invalidBag,
  notAuthorized,
  tagUnavailable,
  unitNumberTaken,
  type RegisterBagError,
} from '../errors.js';

/** This deployment's centre. Multi-tenant needs more rows, not a migration. */
const CENTRE_ID = '01930000-0000-7000-8000-000000000001';

export type BagInput = {
  readonly unitNumber: string;
  readonly bloodGroup: string;
  readonly product: string;
  readonly collectedAt: string;
  readonly source: string | null;
  /** What the label says, where the bag carries one. Optional. */
  readonly labelExpiry: string | null;
  /** Typed, not scanned. Optional: a bag can be registered without a tag. */
  readonly tagUid: string | null;
};

export type RegisterBagResult = {
  readonly bagId: string;
  readonly expiresAt: string;
  readonly expirySource: 'derived' | 'label';
  /**
   * True when the label and the derived date disagreed. The label was used and
   * the bag was registered; this exists so the screen can say so and the
   * operator can go and look at the unit again.
   */
  readonly expiryMismatch: boolean;
  readonly derivedExpiry: string;
};

/**
 * Serialises two operators presenting the same tag (§7.5).
 *
 * The insert comes **first**, and this is the whole point of the function. A
 * bare `SELECT ... FOR UPDATE` locks nothing when the row does not exist yet, so
 * two operators registering the same brand-new tag both saw no row, both
 * inserted, and one crashed on the primary key — which is what happened the
 * first time this was run against real Postgres.
 *
 * `INSERT ... ON CONFLICT DO NOTHING` creates the row or waits for whoever is
 * creating it, and the `FOR UPDATE` that follows then has something real to
 * hold. Exactly one intake proceeds; the second reads the tag as assigned and
 * is told so, rather than failing on a constraint with a message nobody can act
 * on.
 */
async function lockTag(
  tx: Transaction,
  tagUid: string,
): Promise<{ status: string; currentBagId: string | null }> {
  await tx.insert(rfidTags).values({ tagUid, status: 'unassigned' }).onConflictDoNothing();

  const rows = await tx
    .select({ status: rfidTags.status, currentBagId: rfidTags.currentBagId })
    .from(rfidTags)
    .where(eq(rfidTags.tagUid, tagUid))
    .for('update');

  const row = rows[0];
  // The insert above guarantees a row; a missing one means the tag was deleted
  // underneath us, which nothing in this system does.
  if (!row) throw new Error(`tag ${tagUid} vanished during intake`);
  return row;
}

export async function registerBag(
  ctx: UseCaseContext,
  input: BagInput,
): Promise<Result<RegisterBagResult, RegisterBagError>> {
  if (!actorHas(ctx.actor, 'centre:operate')) return err(notAuthorized('centre:operate'));

  const unitNumber = input.unitNumber.trim();
  if (unitNumber.length === 0) return err(invalidBag('Enter the unit number.'));
  if (!isBloodGroup(input.bloodGroup)) return err(invalidBag('Choose a blood group.'));
  if (!isProduct(input.product)) return err(invalidBag('Choose a product.'));

  const collectedAt = parseCalendarDay(input.collectedAt);
  if (!collectedAt) return err(invalidBag('Give the collection date.'));
  if (collectedAt > ctx.clock.today()) {
    return err(invalidBag('The collection date cannot be in the future.'));
  }

  const labelExpiry =
    input.labelExpiry === null || input.labelExpiry.trim() === ''
      ? null
      : parseCalendarDay(input.labelExpiry);
  if (input.labelExpiry && input.labelExpiry.trim() !== '' && !labelExpiry) {
    return err(invalidBag('The expiry date on the label is not a valid date.'));
  }
  if (labelExpiry && labelExpiry < collectedAt) {
    return err(invalidBag('The label expiry cannot be before the collection date.'));
  }

  const bloodGroup: BloodGroup = input.bloodGroup;
  const product: Product = input.product;
  const tagUid = input.tagUid?.trim() ?? '';
  const source = input.source?.trim() ?? '';
  const now = ctx.clock.now();
  const bagId = ctx.ids.next<'BagId'>();
  const actorId = ctx.actor.kind === 'user' ? ctx.actor.userId : null;

  return ctx.db.transaction(async (tx) => {
    /* --- expiry: derived from collection, label wins if present ---------- */
    const [shelf] = await tx
      .select({ days: productShelfLives.shelfLifeDays })
      .from(productShelfLives)
      .where(eq(productShelfLives.product, product));

    if (!shelf) {
      return err(
        invalidBag(
          `No shelf life is configured for ${product}. Set it on the settings screen.`,
        ),
      );
    }

    const derivedExpiry = deriveExpiry(collectedAt, shelf.days);
    const expiresAt = labelExpiry ?? derivedExpiry;
    const expirySource = labelExpiry ? ('label' as const) : ('derived' as const);
    const expiryMismatch = labelExpiry !== null && labelExpiry !== derivedExpiry;

    /* --- the tag, if one was given (§4, §7.5) ---------------------------- */
    if (tagUid !== '') {
      const tag = await lockTag(tx, tagUid);

      if (tag.status === 'retired') {
        return err(tagUnavailable('retired'));
      } else if (tag.status === 'assigned' && tag.currentBagId !== null) {
        // §4's three cases, decided from the register alone.
        const [held] = await tx
          .select({ status: bloodBags.status })
          .from(bloodBags)
          .where(eq(bloodBags.id, tag.currentBagId));

        const status = held?.status ?? 'available';
        if (status === 'available') return err(tagUnavailable('register_conflict'));
        if (status === 'issued' || status === 'reserved') {
          return err(tagUnavailable('bag_live'));
        }
        return err(tagUnavailable('bag_terminal'));
      }
    }

    /* --- the bag ---------------------------------------------------------- */
    const inserted = await tx
      .insert(bloodBags)
      .values({
        id: bagId,
        centreId: CENTRE_ID,
        unitNumber,
        bloodGroup,
        product,
        collectedAt,
        expiresAt,
        expirySource,
        source: source === '' ? null : source,
        status: 'available',
        registeredBy: actorId,
      })
      .onConflictDoNothing()
      .returning({ id: bloodBags.id });

    if (inserted.length === 0) return err(unitNumberTaken());

    if (tagUid !== '') {
      await tx.insert(tagAssignments).values({
        id: ctx.ids.next<'AssignmentId'>(),
        tagUid,
        bagId,
        assignedAt: now,
        assignedBy: actorId,
      });
      await tx
        .update(rfidTags)
        .set({ status: 'assigned', currentBagId: bagId })
        .where(eq(rfidTags.tagUid, tagUid));
    }

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'bag.registered',
      subjectType: 'blood_bag',
      subjectId: bagId,
      metadata: {
        unitNumber,
        bloodGroup,
        product,
        collectedAt,
        expiresAt,
        expirySource,
        expiryMismatch,
        tagUid: tagUid === '' ? null : tagUid,
      },
    });

    return ok({ bagId, expiresAt, expirySource, expiryMismatch, derivedExpiry });
  });
}

/* -------------------------------------------------------------------------- */
/* Expiry sweep                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Marks past-date units `expired`.
 *
 * An expired unit is still physically present and still needs a disposal route
 * (§12.1), so this is not the end of the bag — `expired -> discarded` is, and
 * that flow lands in P6. Until then this at least keeps expired stock out of
 * the decision transaction and out of the floor count, which is the part that
 * can put the wrong unit into a patient.
 *
 * Only `available` bags: a reserved unit belongs to a decision somebody has
 * already been told about, and silently expiring it under them would make the
 * request read as answered while the shelf disagrees.
 */
export async function expireStaleBags(
  ctx: UseCaseContext,
): Promise<{ readonly expired: number }> {
  const today = ctx.clock.today();
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const rows = await tx
      .update(bloodBags)
      .set({ status: 'expired' })
      .where(sql`${bloodBags.status} = 'available' AND ${bloodBags.expiresAt} < ${today}`)
      .returning({ id: bloodBags.id });

    if (rows.length > 0) {
      const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
      await audit({
        action: 'bags.expired',
        subjectType: 'blood_bag',
        subjectId: rows[0]?.id ?? '',
        metadata: { count: rows.length, bagIds: rows.map((row) => row.id), today },
      });
    }

    return { expired: rows.length };
  });
}
