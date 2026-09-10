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
  boolean,
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
/* Returns, quarantine and discards (§4, §5.5)                                 */
/* -------------------------------------------------------------------------- */

/**
 * How long a unit was outside controlled storage (§4).
 *
 * A band, not a number, because nobody at a counter knows it to the minute,
 * and `unknown` is a real answer that has to be recordable, because it is the
 * one that defaults to quarantine.
 */
export const STORAGE_BANDS = ['under_30m', '30m_to_limit', 'over_limit', 'unknown'] as const;
export type StorageBand = (typeof STORAGE_BANDS)[number];

export const RETURN_OUTCOMES = ['restock', 'quarantine', 'discard'] as const;

/**
 * A unit coming back into the centre's custody (§4).
 *
 * **Never writes `expires_at`**. The expiry is a property of the donation, not
 * of the bag's travels, and a return that recalculated it would make a unit
 * fresher for having been carried to a ward and back. §5.5 asks for that to be
 * asserted by a test rather than left to review, and it is.
 */
export const bagReturns = hospitalSchema.table(
  'bag_returns',
  {
    id: uuid('id').primaryKey(),
    bagId: uuid('bag_id')
      .notNull()
      .references(() => bloodBags.id),
    returnedAt: timestamp('returned_at', { withTimezone: true }).notNull().defaultNow(),
    outOfStorageBand: text('out_of_storage_band').notNull(),
    coldChainDocumented: boolean('cold_chain_documented').notNull().default(false),
    outcome: text('outcome').notNull(),
    note: text('note'),
    /** A named person, always. Restocking is a clinical judgement (§4). */
    decidedBy: uuid('decided_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('bag_returns_bag_idx').on(table.bagId, table.returnedAt.desc()),
    check(
      'bag_returns_band_check',
      sql`out_of_storage_band IN ('under_30m', '30m_to_limit', 'over_limit', 'unknown')`,
    ),
    check('bag_returns_outcome_check', sql`outcome IN ('restock', 'quarantine', 'discard')`),
    /**
     * A unit whose time out of storage is unknown, or past the limit, is never
     * restocked (§4). The database refuses it, so no screen and no future code
     * path can put one back on the shelf.
     */
    check(
      'bag_returns_restock_check',
      sql`outcome <> 'restock' OR out_of_storage_band = 'under_30m'`,
    ),
  ],
);

export const QUARANTINE_RESOLUTIONS = ['available', 'discarded'] as const;

/**
 * **A waiting room, not a destination** (§4).
 *
 * A quarantined bag is out of issue and out of the stock floor, ages visibly,
 * and must be resolved by a named person to one of exactly two ends. Nothing
 * sits here indefinitely. The ageing escalation and the automatic discard at
 * expiry are what make that true rather than aspirational.
 */
export const bagQuarantines = hospitalSchema.table(
  'bag_quarantines',
  {
    id: uuid('id').primaryKey(),
    bagId: uuid('bag_id')
      .notNull()
      .references(() => bloodBags.id),
    reason: text('reason').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolution: text('resolution'),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    note: text('note'),
  },
  (table) => [
    // One open quarantine per bag: two would make "how long has this been
    // waiting" unanswerable.
    uniqueIndex('bag_quarantines_open_idx').on(table.bagId).where(sql`resolved_at IS NULL`),
    // The ageing escalation of §4 reads this.
    index('bag_quarantines_ageing_idx').on(table.openedAt).where(sql`resolved_at IS NULL`),
    check(
      'bag_quarantines_resolution_check',
      sql`resolution IS NULL OR resolution IN ('available', 'discarded')`,
    ),
    // Resolved means resolved by somebody, to something.
    check(
      'bag_quarantines_resolved_check',
      sql`(resolved_at IS NULL) = (resolution IS NULL)`,
    ),
  ],
);

/**
 * The end of a bag (§12.1).
 *
 * `disposal_route` is required, because **a status change is not the end of the
 * bag**: a unit of human blood has to physically go somewhere, and a register
 * that says `discarded` without saying where cannot answer that.
 */
export const bagDiscards = hospitalSchema.table(
  'bag_discards',
  {
    id: uuid('id').primaryKey(),
    bagId: uuid('bag_id')
      .notNull()
      .references(() => bloodBags.id),
    reason: text('reason').notNull(),
    disposalRoute: text('disposal_route').notNull(),
    note: text('note'),
    discardedBy: uuid('discarded_by').references(() => users.id),
    discardedAt: timestamp('discarded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A bag is discarded once.
    uniqueIndex('bag_discards_bag_idx').on(table.bagId),
    index('bag_discards_when_idx').on(table.discardedAt.desc()),
    check('bag_discards_route_check', sql`length(trim(disposal_route)) > 0`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Case 3. The discrepancy (§4, §7.5)                                         */
/* -------------------------------------------------------------------------- */

export const DISCREPANCY_STATUSES = ['open', 'resolved'] as const;
export const DISCREPANCY_FINDINGS = ['duplicate_tag', 'bag_missing', 'mis_scan'] as const;
export type DiscrepancyFinding = (typeof DISCREPANCY_FINDINGS)[number];

/**
 * A tag presented as new whose bag the register believes is on the shelf.
 *
 * One of: the register is stale, two bags carry the same tag, or the tag is
 * cloned, and every one of those can put the wrong unit into a patient. So it
 * stops and makes a person go and look.
 *
 * **Never auto-resolves and never expires** (§4). No job touches this table, and
 * that absence is deliberate: the expiry sweep, the quarantine escalation and
 * every other scheduled thing leave it alone. It is the one alarm in this module
 * worth being loud.
 */
export const tagDiscrepancies = hospitalSchema.table(
  'tag_discrepancies',
  {
    id: uuid('id').primaryKey(),
    tagUid: text('tag_uid')
      .notNull()
      .references(() => rfidTags.tagUid),
    presentedAt: timestamp('presented_at', { withTimezone: true }).notNull().defaultNow(),
    presentedBy: uuid('presented_by').references(() => users.id),
    /** The bag the register thinks is on the shelf. Somebody must go and look. */
    conflictingBagId: uuid('conflicting_bag_id')
      .notNull()
      .references(() => bloodBags.id),
    status: text('status').notNull().default('open'),
    finding: text('finding'),
    note: text('note'),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The centre overview reads this, and it stays visible until a person
    // closes it.
    index('tag_discrepancies_open_idx').on(table.status, table.presentedAt),
    check('tag_discrepancies_status_check', sql`status IN ('open', 'resolved')`),
    check(
      'tag_discrepancies_finding_check',
      sql`finding IS NULL OR finding IN ('duplicate_tag', 'bag_missing', 'mis_scan')`,
    ),
    /**
     * Resolved means a person, a finding and a note, all three.
     *
     * §4 gives three findings and three fixed actions, "each requiring the
     * resolver's identity and a note". A row closed without them records that
     * somebody made it go away, not what they found.
     */
    check(
      'tag_discrepancies_resolved_check',
      sql`(status = 'resolved') = (resolved_at IS NOT NULL AND finding IS NOT NULL
                                    AND resolved_by IS NOT NULL AND note IS NOT NULL)`,
    ),
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
    /**
     * Answered before anybody said who it was for (§4, ADR 0010).
     *
     * Only an emergency may be, and the fact is recorded here rather than
     * inferred later from whether the request has a patient now, by then it
     * will have one, and the exception would be invisible. An issued unit
     * pointing at nobody is a debt, and this is the record that it was taken on.
     */
    patientUnidentified: boolean('patient_unidentified').notNull().default(false),

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
 * grants in the migration are the database's own copy of the same rule: §11.2
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
     * second centre is more rows rather than a migration, and a global index
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
     * from it, and it is here as well, because a demand for platelets is a
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
 *, which is what lets the same person be reached on Telegram today and
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
    /**
     * The group the counter actually typed, which is not the same claim as the
     * group the donor believes they are.
     *
     * Added in P6 because without it nothing could ever set
     * `bot.donors.blood_group_verified_at`: §7.7 excludes an unverified donor
     * from every wave, the centre is the authority on a group, and `app_web`
     * holds no grant on the bot's schema at all. So a donor who registered
     * could never be recruited, and there was no path out of that except
     * trusting a self-declaration, which is exactly what the column exists to
     * prevent. An additive column, so a minor contract bump (§11.8).
     */
    donatedBloodGroup: text('donated_blood_group'),
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
    check(
      'donor_demand_confirmations_typed_group_check',
      sql`donated_blood_group IS NULL OR donated_blood_group IN
            ('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+')`,
    ),
  ],
);

/**
 * Somebody who gave blood without ever being in the bot (§4).
 *
 * **Not a confirmation row.** §5.1 gives the centre no INSERT on
 * `donor_demand_confirmations` at all: the bot creates the roster, the centre
 * marks what happened at the counter, and that split is a grant rather than a
 * convention. The first version of `recordWalkIn` inserted a confirmation and
 * was refused by the database the moment it ran as `app_web`. Correctly, and
 * that refusal is the reason this table exists.
 *
 * It is the centre's own record, in the centre's own half. The bot may read it,
 * because a unit already collected is a unit it must stop recruiting for
 * (contract 1.2.0): without that, a demand covered by walk-ins would keep
 * calling real people in for blood the shelf already has.
 */
export const walkInDonations = hospitalSchema.table(
  'walk_in_donations',
  {
    id: uuid('id').primaryKey(),
    demandId: uuid('demand_id')
      .notNull()
      .references(() => donorDemand.id),

    donorName: text('donor_name').notNull(),
    donorPhone: text('donor_phone').notNull(),
    /** The group the unit **typed as**. The only group anybody here measured. */
    bloodGroup: text('blood_group').notNull(),
    bagIdentifier: text('bag_identifier').notNull(),
    donatedOn: date('donated_on').notNull(),

    recordedBy: uuid('recorded_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The bot's poll: how many units this demand has already collected outside
    // the roster.
    index('walk_in_donations_demand_idx').on(table.demandId),
    check(
      'walk_in_donations_group_check',
      sql`blood_group IN ('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+')`,
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
  walkIns: many(walkInDonations),
}));
