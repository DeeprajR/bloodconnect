/**
 * The `hospital` schema, Module 2 and the shared contract (§5.5, §5.6).
 *
 * The register, the decision, and the two tables the bot shares. Three things
 * in here are load-bearing and are not conveniences:
 *
 *  1. **A tag is hardware; a bag is a consumable.** They are separate tables
 *     with an append-only assignment history between them, which is what turns
 *     §4's three collision cases into a lookup instead of a pile of
 *     special-casing.
 *  2. **The partial index on available stock** is the index the decision
 *     transaction of §7.2 lives on. Without it the `FOR UPDATE SKIP LOCKED`
 *     claim degrades into a scan of every bag the centre has ever held.
 *  3. **`centre_decisions.request_id` is unique.** That constraint, and not any
 *     application check, is what stops a request being decided twice.
 *
 * P3 builds the register and the decision. Returns, quarantine, discards, tag
 * discrepancies and the cameras (§5.5) arrive in P6 and P11; their tables are
 * deliberately absent rather than present and unused, so nothing reads as
 * finished when it is not.
 */

import { relations, sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { hospitalSchema, users } from './platform.js';
import { locationNodes } from './reference.js';
import { bloodRequests, centres } from './hospital.js';

/* -------------------------------------------------------------------------- */
/* Settings and shelf lives                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The single settings row (§5.5).
 *
 * Snapshotted onto every demand as it is raised, never retroactively (§2.6):
 * this is what donors were told at the time, and correcting the hospital's
 * address next month must not silently rewrite a message somebody already
 * acted on.
 */
export const centreSettings = hospitalSchema.table(
  'centre_settings',
  {
    id: integer('id').primaryKey(),
    centreId: uuid('centre_id')
      .notNull()
      .references(() => centres.id),
    hospitalName: text('hospital_name').notNull(),
    address: text('address').notNull(),
    /** Where donors are asked to come. Nullable until someone has set it. */
    districtId: text('district_id').references(() => locationNodes.id),
    cityId: text('city_id').references(() => locationNodes.id),
    /** §4's stock floor. 25 units per group by default. */
    minUnitsPerGroup: integer('min_units_per_group').notNull().default(25),
    /**
     * How long a unit may be out of controlled storage and still be restocked.
     * Read out of the hospital's own SOP rather than hard-coded (§4); the
     * return flow that consumes it lands in P6.
     */
    returnTimeLimitMinutes: integer('return_time_limit_minutes').notNull().default(30),
    updatedBy: uuid('updated_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [check('centre_settings_single_row', sql`id = 1`)],
);

/**
 * Shelf life per component, in whole days (§4).
 *
 * Configuration, so a corrected figure is a row rather than a deploy. The
 * expiry it drives is derived **from the collection date**, never from intake:
 * a bag does not become fresher by being handled.
 */
export const productShelfLives = hospitalSchema.table(
  'product_shelf_lives',
  {
    product: text('product').primaryKey(),
    shelfLifeDays: integer('shelf_life_days').notNull(),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    check(
      'product_shelf_lives_product_check',
      sql`product IN ('whole_blood', 'prbc', 'platelet_concentrate', 'ffp', 'cryoprecipitate')`,
    ),
    check('product_shelf_lives_days_check', sql`shelf_life_days > 0`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Tags and bags                                                               */
/* -------------------------------------------------------------------------- */

/**
 * One row per physical bag. The register is the source of truth (§4).
 *
 * The status list and the expiry sources are not repeated here: they live in
 * `packages/domain` (`BAG_STATUSES`, `EXPIRY_SOURCES`) with the transition
 * table that governs them, and a second copy in the schema is a second thing to
 * forget to update. The CHECK constraints below are the database's own
 * enforcement of the same list, which is the copy worth having.
 */
export const bloodBags = hospitalSchema.table(
  'blood_bags',
  {
    id: uuid('id').primaryKey(),
    centreId: uuid('centre_id')
      .notNull()
      .references(() => centres.id),
    /** The donation number printed on the bag. Unique across the centre. */
    unitNumber: text('unit_number').notNull(),
    bloodGroup: text('blood_group').notNull(),
    product: text('product').notNull(),
    /** A day, not an instant (§5.2). The expiry clock runs from here. */
    collectedAt: date('collected_at').notNull(),
    expiresAt: date('expires_at').notNull(),
    /**
     * Which claim this expiry is. "The label said so" and "we calculated it"
     * are different claims when a unit is questioned later, so the answer is
     * recorded rather than reconstructed (§4).
     */
    expirySource: text('expiry_source').notNull().default('derived'),
    source: text('source'),
    status: text('status').notNull().default('available'),
    /**
     * Held for a specific request between the decision and physical collection.
     * A reserved bag counts as unavailable for any other request and is
     * excluded from the stock floor (§4).
     */
    reservedForRequestId: uuid('reserved_for_request_id').references(() => bloodRequests.id),
    issuedToRequestId: uuid('issued_to_request_id').references(() => bloodRequests.id),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    registeredBy: uuid('registered_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('blood_bags_unit_number_idx').on(table.unitNumber),
    /**
     * The index the decision transaction lives on (§5.5, §7.2).
     *
     * Partial on `available` because that is the only status the claim ever
     * looks at, and ordered by expiry because the claim always takes the
     * shortest-dated unit first.
     */
    index('blood_bags_available_idx')
      .on(table.bloodGroup, table.product, table.expiresAt)
      .where(sql`status = 'available'`),
    index('blood_bags_status_idx').on(table.status, table.expiresAt),
    check('blood_bags_expiry_check', sql`expires_at >= collected_at`),
    check(
      'blood_bags_group_check',
      sql`blood_group IN ('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+')`,
    ),
    check(
      'blood_bags_product_check',
      sql`product IN ('whole_blood', 'prbc', 'platelet_concentrate', 'ffp', 'cryoprecipitate')`,
    ),
    check(
      'blood_bags_status_check',
      sql`status IN ('available', 'reserved', 'issued', 'returned', 'quarantined', 'discarded', 'expired', 'lost')`,
    ),
    check('blood_bags_expiry_source_check', sql`expiry_source IN ('derived', 'label')`),
    // A reserved bag without the request it is held for is a unit nobody can
    // account for and nobody will release.
    check(
      'blood_bags_reserved_check',
      sql`status <> 'reserved' OR reserved_for_request_id IS NOT NULL`,
    ),
    check(
      'blood_bags_issued_check',
      sql`status <> 'issued' OR (issued_to_request_id IS NOT NULL AND issued_at IS NOT NULL)`,
    ),
  ],
);

export const TAG_STATUSES = ['unassigned', 'assigned', 'retired'] as const;
export type TagStatus = (typeof TAG_STATUSES)[number];

/**
 * A tag is a plastic object that outlives many bags (§4).
 *
 * Modelling it separately from the bag is the decision that makes the three
 * collision cases decidable. `current_bag_id` is a cache of the open row in
 * `tag_assignments`; the assignment table is the history and the authority.
 */
export const rfidTags = hospitalSchema.table(
  'rfid_tags',
  {
    tagUid: text('tag_uid').primaryKey(),
    status: text('status').notNull().default('unassigned'),
    /**
     * A cache of the open row in `tag_assignments`, which is the authority.
     * Declared after `blood_bags` purely so this can be a real foreign key: a
     * `current_bag_id` pointing at nothing is the kind of thing that rots
     * quietly and is discovered during an investigation.
     */
    currentBagId: uuid('current_bag_id').references(() => bloodBags.id),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    retireReason: text('retire_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    check('rfid_tags_status_check', sql`status IN ('unassigned', 'assigned', 'retired')`),
    check('rfid_tags_assigned_check', sql`status <> 'assigned' OR current_bag_id IS NOT NULL`),
    // A retired tag can never carry a bag again (§4). Enforced here so no code
    // path, present or future, can put one back into service.
    check('rfid_tags_retired_check', sql`status <> 'retired' OR current_bag_id IS NULL`),
    check('rfid_tags_retired_at_check', sql`(status = 'retired') = (retired_at IS NOT NULL)`),
  ],
);

/**
 * Append-only (§5.5). It is how you answer "what was on this tag in March?"
 * after the tag has been reused twice.
 */
export const tagAssignments = hospitalSchema.table(
  'tag_assignments',
  {
    id: uuid('id').primaryKey(),
    tagUid: text('tag_uid')
      .notNull()
      .references(() => rfidTags.tagUid),
    bagId: uuid('bag_id')
      .notNull()
      .references(() => bloodBags.id),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    assignedBy: uuid('assigned_by').references(() => users.id),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    releasedBy: uuid('released_by').references(() => users.id),
    releaseReason: text('release_reason'),
  },
  (table) => [
    /**
     * One live assignment each way (§5.5).
     *
     * These two partial uniques are what make the collisions of §4 decidable
     * from the register alone: a tag cannot be on two bags, and a bag cannot
     * wear two tags, without the database refusing the second one.
     */
    uniqueIndex('tag_assignments_live_tag_idx')
      .on(table.tagUid)
      .where(sql`released_at IS NULL`),
    uniqueIndex('tag_assignments_live_bag_idx')
      .on(table.bagId)
      .where(sql`released_at IS NULL`),
    index('tag_assignments_bag_idx').on(table.bagId, table.assignedAt.desc()),
  ],
);

/* -------------------------------------------------------------------------- */
/* Decisions                                                                   */
/* -------------------------------------------------------------------------- */

export const DECISIONS = ['approved', 'partial', 'declined'] as const;
export type Decision = (typeof DECISIONS)[number];

/**
 * One decision per request, and the unique constraint is what enforces it
 * (§5.5, §7.2, §11.5).
 *
 * Not an application check: two counter staff opening the same request in two
 * tabs is an ordinary Tuesday, and the second transaction has to fail on
 * something the first one committed. That something is this index.
 */
export const centreDecisions = hospitalSchema.table(
  'centre_decisions',
  {
    id: uuid('id').primaryKey(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => bloodRequests.id),
    decision: text('decision').notNull(),
    unitsIssued: integer('units_issued').notNull().default(0),
    unitsRequested: integer('units_requested').notNull(),
    note: text('note'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
    /** The demand a shortfall raised, in the same transaction (§7.2). */
    demandId: uuid('demand_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('centre_decisions_request_idx').on(table.requestId),
    check(
      'centre_decisions_decision_check',
      sql`decision IN ('approved', 'partial', 'declined')`,
    ),
    check(
      'centre_decisions_units_check',
      sql`units_issued >= 0 AND units_issued <= units_requested`,
    ),
    // The three decisions differ by how many units they issued, and the words
    // have to keep agreeing with the numbers.
    check(
      'centre_decisions_consistency_check',
      sql`(decision = 'declined' AND units_issued = 0)
       OR (decision = 'approved' AND units_issued = units_requested)
       OR (decision = 'partial' AND units_issued > 0 AND units_issued < units_requested)`,
    ),
  ],
);

/** Which bags went to which decision. A bag is issued once (§5.5). */
export const decisionBags = hospitalSchema.table(
  'decision_bags',
  {
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => centreDecisions.id),
    bagId: uuid('bag_id')
      .notNull()
      .references(() => bloodBags.id),
  },
  (table) => [
    primaryKey({ columns: [table.decisionId, table.bagId] }),
    uniqueIndex('decision_bags_bag_idx').on(table.bagId),
  ],
);

/* -------------------------------------------------------------------------- */
/* The shared contract (§5.6, §6, §7)                                          */
/* -------------------------------------------------------------------------- */

/**
 * The centre's half of the contract, written by both sides (§7).
 *
 * Created **only** by this migration set. The column list, the ownership and
 * the legal transitions all live in `packages/contract`, and the column-level
 * grants in the migration are the database's own copy of the same rule — §11.2
 * names a one-sided change to this table as the most likely way the system
 * breaks in production, so it is defended three times over.
 */
export const donorDemand = hospitalSchema.table(
  'donor_demand',
  {
    id: uuid('id').primaryKey(),
    centreId: uuid('centre_id')
      .notNull()
      .references(() => centres.id),

    /* --- the centre: what is needed --- */
    trigger: text('trigger').notNull(),
    /** Null for a `stock_floor` demand: it answers no single request. */
    bloodRequestId: uuid('blood_request_id').references(() => bloodRequests.id),
    bloodGroup: text('blood_group').notNull(),
    product: text('product').notNull(),
    units: integer('units').notNull(),
    dateRequired: date('date_required').notNull(),

    /* --- the centre: what donors are told, snapshotted (§2.6) --- */
    hospitalName: text('hospital_name').notNull(),
    hospitalAddress: text('hospital_address').notNull(),
    districtId: text('district_id').notNull(),
    cityId: text('city_id'),
    notes: text('notes'),

    /* --- both --- */
    status: text('status').notNull().default('open'),

    /* --- the bot --- */
    botPublicId: text('bot_public_id'),
    importedAt: timestamp('imported_at', { withTimezone: true }),
    donorsNotified: integer('donors_notified').notNull().default(0),
    confirmedUnits: integer('confirmed_units').notNull().default(0),
    waitlistedUnits: integer('waitlisted_units').notNull().default(0),
    completedUnits: integer('completed_units').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The bot's poll (§5.6): open demands it has not yet imported.
    index('donor_demand_awaiting_import_idx')
      .on(table.status, table.botPublicId)
      .where(sql`status = 'open' AND bot_public_id IS NULL`),
    /**
     * "Recruit for groups below floor" cannot double-raise (§4, §5.6).
     *
     * §5.6 writes this as unique on `blood_group` alone. Scoped by centre here,
     * because `centre_id` exists on this table from day one precisely so a
     * second centre is more rows rather than a migration — and a global index
     * would make the second centre unable to recruit for a group the first one
     * is already short of. Identical behaviour for the single centre v1 runs.
     */
    uniqueIndex('donor_demand_open_floor_idx')
      .on(table.centreId, table.bloodGroup)
      .where(sql`trigger = 'stock_floor' AND status = 'open'`),
    index('donor_demand_status_idx').on(table.status, table.dateRequired),
    check('donor_demand_trigger_check', sql`trigger IN ('request_shortfall', 'stock_floor')`),
    check(
      'donor_demand_status_check',
      sql`status IN ('open', 'fulfilled', 'completed', 'cancelled', 'expired')`,
    ),
    check(
      'donor_demand_group_check',
      sql`blood_group IN ('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+')`,
    ),
    /**
     * Only whole blood and packed red cells recruit donors (§4).
     *
     * The rule is in `packages/domain` and the screen disables the checkbox
     * from it — and it is here as well, because a demand for platelets is a
     * message sent to real people asking for something they cannot give.
     */
    check('donor_demand_product_check', sql`product IN ('whole_blood', 'prbc')`),
    check('donor_demand_units_check', sql`units >= 1`),
    check(
      'donor_demand_counters_check',
      sql`donors_notified >= 0 AND confirmed_units >= 0 AND waitlisted_units >= 0 AND completed_units >= 0`,
    ),
    // A shortfall demand names its request; a floor demand answers none.
    check(
      'donor_demand_trigger_link_check',
      sql`(trigger = 'request_shortfall') = (blood_request_id IS NOT NULL)`,
    ),
  ],
);

/**
 * The roster (§5.6). The bot creates a row; the counter records what happened.
 *
 * `donor_id` is the bot's **internal** donor id, not a platform user id (§2.11)
 * — which is what lets the same person be reached on Telegram today and
 * WhatsApp tomorrow without the centre's roster changing shape. There is
 * deliberately no foreign key: the donor table lives in the `bot` schema, which
 * this application cannot see at all.
 */
export const donorDemandConfirmations = hospitalSchema.table(
  'donor_demand_confirmations',
  {
    id: uuid('id').primaryKey(),
    demandId: uuid('demand_id')
      .notNull()
      .references(() => donorDemand.id),
    donorId: uuid('donor_id').notNull(),
    channel: text('channel').notNull(),

    /* --- the bot --- */
    donorName: text('donor_name').notNull(),
    donorPhone: text('donor_phone').notNull(),
    bloodGroup: text('blood_group').notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),

    /* --- both --- */
    status: text('status').notNull().default('confirmed'),

    /* --- the centre, at the counter --- */
    donatedAt: date('donated_at'),
    bagIdentifier: text('bag_identifier'),
    markedBy: uuid('marked_by'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('donor_demand_confirmations_donor_idx').on(table.demandId, table.donorId),
    index('donor_demand_confirmations_status_idx').on(table.demandId, table.status),
    check(
      'donor_demand_confirmations_status_check',
      sql`status IN ('confirmed', 'completed', 'no_show', 'cancelled')`,
    ),
    check(
      'donor_demand_confirmations_group_check',
      sql`blood_group IN ('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+')`,
    ),
    // Only a completed donation has a donation day.
    check(
      'donor_demand_confirmations_donated_check',
      sql`donated_at IS NULL OR status = 'completed'`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* Relations                                                                   */
/* -------------------------------------------------------------------------- */

export const bloodBagRelations = relations(bloodBags, ({ many }) => ({
  assignments: many(tagAssignments),
}));

export const tagAssignmentRelations = relations(tagAssignments, ({ one }) => ({
  tag: one(rfidTags, { fields: [tagAssignments.tagUid], references: [rfidTags.tagUid] }),
  bag: one(bloodBags, { fields: [tagAssignments.bagId], references: [bloodBags.id] }),
}));

export const centreDecisionRelations = relations(centreDecisions, ({ one, many }) => ({
  request: one(bloodRequests, {
    fields: [centreDecisions.requestId],
    references: [bloodRequests.id],
  }),
  bags: many(decisionBags),
}));

export const donorDemandRelations = relations(donorDemand, ({ many }) => ({
  confirmations: many(donorDemandConfirmations),
}));
