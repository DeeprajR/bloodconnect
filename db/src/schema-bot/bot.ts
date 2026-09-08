/**
 * The `bot` schema (§5.7).
 *
 * A **separate migration set**, applied by the bot's own release (§5.9). The two
 * shared contract tables live in `hospital` and are created only by
 * `db/migrations` — a CI check greps this set for `donor_demand` and fails the
 * build if it appears (§2.1). The bot reaches them through granted columns, not
 * through its own DDL.
 *
 * Four things in here are load-bearing, and each exists because the alternative
 * fails in a way nobody notices:
 *
 *  1. **`next_eligible_on` is stored**, not computed. A wave query cannot run an
 *     interval calculation per row across a large donor pool, so the value is
 *     denormalised, indexed, and recomputed by the domain on every change.
 *  2. **`bot_requests.next_wave_at` is a column the ticker polls**, not an
 *     in-memory timer. A restart must not silently stop escalation.
 *  3. **Questionnaire progress lives on `donor_requests`**, not in session
 *     memory, so a duplicate tap on question three is recognised as already
 *     answered and the flow survives a restart.
 *  4. **`message_outbox` is the stand-down guarantee** (§7.6). A demand closed
 *     without its stand-down messages sent is the failure this system must not
 *     have, so the messages are committed as rows with the closure and drained
 *     separately — never sent inside the closing transaction, where a chat API
 *     timeout after the commit would lose them silently.
 */

import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { locationNodes } from '../schema/reference.js';

export const botSchema = pgSchema('bot');

/* -------------------------------------------------------------------------- */
/* Donors                                                                      */
/* -------------------------------------------------------------------------- */

export const DURABLE_FLAG_STATUSES = ['clear', 'flagged'] as const;

export const donors = botSchema.table(
  'donors',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    dob: date('dob').notNull(),
    sex: text('sex').notNull(),
    bloodGroup: text('blood_group').notNull(),
    /**
     * A self-declared group is not a verified one. The wave query requires this
     * to be set, because recruiting on an unverified group sends the wrong
     * person to the counter — the pre-transfusion test would catch it, but the
     * donor made the trip for nothing.
     */
    bloodGroupVerifiedAt: timestamp('blood_group_verified_at', { withTimezone: true }),

    weightBand: text('weight_band').notNull(),
    /**
     * Derived from the band's lower bound when the donor gives no exact figure,
     * so the threshold comparison is never null-skipped (§5.7).
     */
    weightKg: integer('weight_kg').notNull(),

    /* --- where they are, resolved and as they typed it --- */
    districtId: text('district_id').references(() => locationNodes.id),
    cityId: text('city_id').references(() => locationNodes.id),
    townId: text('town_id').references(() => locationNodes.id),
    localityId: text('locality_id').references(() => locationNodes.id),
    /**
     * What the donor actually typed, kept beside the resolved id. Unmatched free
     * text never silently creates a place (§5.7) — it goes to the review queue,
     * and this is what the reviewer reads.
     */
    districtText: text('district_text'),
    cityText: text('city_text'),
    townText: text('town_text'),
    localityText: text('locality_text'),

    lastDonatedOn: date('last_donated_on'),
    /** Stored and indexed. Recomputed by the domain on every change (§5.7). */
    nextEligibleOn: date('next_eligible_on'),

    durableFlagStatus: text('durable_flag_status').notNull().default('clear'),
    snoozeUntil: date('snooze_until'),
    optedOutAt: timestamp('opted_out_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /**
     * Denormalised so the wave query stays indexable. `donor_consents` remains
     * the authoritative history of what was agreed to and when.
     */
    consentCurrentAt: timestamp('consent_current_at', { withTimezone: true }),
    language: text('language').notNull().default('en'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * The index the wave query runs on (§7.7). Group first because it is the
     * equality filter, then the eligibility day, which is the range.
     */
    index('donors_wave_idx').on(table.bloodGroup, table.nextEligibleOn),
    index('donors_locality_idx').on(table.localityId),
    index('donors_district_idx').on(table.districtId),
    check('donors_sex_check', sql`sex IN ('female', 'male', 'other')`),
    check(
      'donors_group_check',
      sql`blood_group IN ('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+')`,
    ),
    check(
      'donors_weight_band_check',
      sql`weight_band IN ('under_45', '45_50', '50_60', '60_70', '70_plus')`,
    ),
    check('donors_flag_check', sql`durable_flag_status IN ('clear', 'flagged')`),
    check('donors_weight_check', sql`weight_kg >= 0`),
  ],
);

/**
 * One row per way of reaching a person (§2.11).
 *
 * The channel is swappable, so the donor's identity is this table's `donor_id`
 * and never a Telegram user id. Adding WhatsApp later is a row here, not a
 * column on `donors`.
 */
export const donorChannels = botSchema.table(
  'donor_channels',
  {
    donorId: uuid('donor_id')
      .notNull()
      .references(() => donors.id),
    channel: text('channel').notNull(),
    channelUserId: text('channel_user_id').notNull(),
    optedInAt: timestamp('opted_in_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.donorId, table.channel] }),
    // One account on one platform is one person (§2.11).
    uniqueIndex('donor_channels_identity_idx').on(table.channel, table.channelUserId),
  ],
);

/** The verified number is what links one person across channels (§5.7). */
export const donorPhones = botSchema.table(
  'donor_phones',
  {
    donorId: uuid('donor_id')
      .notNull()
      .references(() => donors.id),
    e164: text('e164').notNull(),
    verified: boolean('verified').notNull().default(false),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.donorId, table.e164] }),
    uniqueIndex('donor_phones_verified_idx').on(table.e164).where(sql`verified`),
  ],
);

/**
 * "They consented to *this text*, showing *these values*, at *this time*" (§5).
 *
 * The wording version and the values snapshot are both stored, because consent
 * to a form nobody kept a copy of is not evidence of anything.
 */
export const donorConsents = botSchema.table(
  'donor_consents',
  {
    id: uuid('id').primaryKey(),
    donorId: uuid('donor_id')
      .notNull()
      .references(() => donors.id),
    consentedAt: timestamp('consented_at', { withTimezone: true }).notNull().defaultNow(),
    wordingVersion: text('wording_version').notNull(),
    valuesSnapshot: jsonb('values_snapshot').notNull(),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  },
  (table) => [index('donor_consents_donor_idx').on(table.donorId, table.consentedAt.desc())],
);

/**
 * **Durable answers only** (§5).
 *
 * "Have you ever had jaundice" belongs to the person. "Did you eat today"
 * belongs to one visit, lives on the journey row, and must never reach the
 * profile — a temporary answer stored here would defer somebody permanently.
 */
export const donorScreeningAnswers = botSchema.table(
  'donor_screening_answers',
  {
    donorId: uuid('donor_id')
      .notNull()
      .references(() => donors.id),
    questionKey: text('question_key').notNull(),
    answer: text('answer').notNull(),
    answeredAt: timestamp('answered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.donorId, table.questionKey] })],
);

/* -------------------------------------------------------------------------- */
/* Requests, as the bot sees them                                              */
/* -------------------------------------------------------------------------- */

export const BOT_REQUEST_STATUSES = ['open', 'fulfilled', 'completed', 'cancelled', 'expired'] as const;

/**
 * The bot's view of one demand (§5.7).
 *
 * `demand_id` is unique, which is what makes the import idempotent: a demand is
 * never fanned out twice however often the ticker runs.
 */
export const botRequests = botSchema.table(
  'bot_requests',
  {
    id: uuid('id').primaryKey(),
    /** The `hospital.donor_demand` row this came from. No foreign key: the two
     * schemas are owned by different releases, and the bot holds no DDL rights
     * on `hospital` at all. Uniqueness is what matters, and it is here. */
    demandId: uuid('demand_id').notNull(),
    /** The deep-link id, shown to donors and written back onto the demand. */
    publicId: text('public_id').notNull(),

    bloodGroup: text('blood_group').notNull(),
    product: text('product').notNull(),
    unitsNeeded: integer('units_needed').notNull(),
    confirmedCount: integer('confirmed_count').notNull().default(0),
    waitlistedCount: integer('waitlisted_count').notNull().default(0),
    completedCount: integer('completed_count').notNull().default(0),
    /**
     * Units already collected from people who were never in the bot at all
     * (contract 1.2.0).
     *
     * Read from `hospital.walk_in_donations`, which the centre owns and the bot
     * may only SELECT. It is kept beside `units_needed` rather than subtracted
     * from it so that the original need stays legible: three units were wanted,
     * one walked in, and two donors are still worth calling.
     *
     * Every place that asks "does this still need people?" counts it, because
     * the alternative is calling real donors in for blood the shelf already has.
     */
    walkInUnits: integer('walk_in_units').notNull().default(0),
    neededBy: date('needed_by').notNull(),

    /** What donors are told, frozen at import (§2.6). Never joined back. */
    hospitalSnapshot: jsonb('hospital_snapshot').notNull(),

    status: text('status').notNull().default('open'),
    /**
     * **A column the ticker polls, not an in-memory timer** (§5.7). A process
     * restart resumes escalation instead of silently stopping it.
     */
    nextWaveAt: timestamp('next_wave_at', { withTimezone: true }),
    waveNo: integer('wave_no').notNull().default(0),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closureReason: text('closure_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('bot_requests_demand_idx').on(table.demandId),
    uniqueIndex('bot_requests_public_idx').on(table.publicId),
    // The ticker's poll: what is due a wave.
    index('bot_requests_wave_idx').on(table.status, table.nextWaveAt),
    check(
      'bot_requests_status_check',
      sql`status IN ('open', 'fulfilled', 'completed', 'cancelled', 'expired')`,
    ),
    check('bot_requests_units_check', sql`units_needed >= 1`),
    check(
      'bot_requests_counts_check',
      sql`confirmed_count >= 0 AND waitlisted_count >= 0 AND completed_count >= 0`,
    ),
    // The conditional UPDATE of §7.3 depends on this never being exceeded.
    check('bot_requests_confirmed_cap', sql`confirmed_count <= units_needed`),
    check('bot_requests_closed_check', sql`(closed_at IS NULL) = (closure_reason IS NULL)`),
  ],
);

export const DONOR_JOURNEY_STATUSES = [
  'NOTIFIED',
  'ACCEPTED',
  'SCREENING',
  'CONFIRMED',
  'REQUEST_FILLED',
  'DECLINED',
  'DEFERRED',
  'COMPLETED',
  'NO_SHOW',
  'CANCELLED',
] as const;

/**
 * One row per donor per request — the journey (§5.7).
 *
 * `screening_index` and `screening_answers` live here rather than in session
 * memory, which is what makes a duplicate tap on question three recognisable as
 * already answered, and what lets the flow survive a restart (§7.4).
 */
export const donorRequests = botSchema.table(
  'donor_requests',
  {
    id: uuid('id').primaryKey(),
    botRequestId: uuid('bot_request_id')
      .notNull()
      .references(() => botRequests.id),
    donorId: uuid('donor_id')
      .notNull()
      .references(() => donors.id),
    status: text('status').notNull().default('NOTIFIED'),
    waveNo: integer('wave_no').notNull(),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    screeningIndex: integer('screening_index').notNull().default(0),
    screeningAnswers: jsonb('screening_answers').notNull().default({}),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    terminalAt: timestamp('terminal_at', { withTimezone: true }),
    /** Where the card was posted, so it can be edited in place if supported. */
    cardRef: text('card_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A donor is asked once per request, however many waves run.
    uniqueIndex('donor_requests_unique_idx').on(table.botRequestId, table.donorId),
    index('donor_requests_status_idx').on(table.botRequestId, table.status),
    index('donor_requests_donor_idx').on(table.donorId),
    check(
      'donor_requests_status_check',
      sql`status IN ('NOTIFIED', 'ACCEPTED', 'SCREENING', 'CONFIRMED', 'REQUEST_FILLED',
                     'DECLINED', 'DEFERRED', 'COMPLETED', 'NO_SHOW', 'CANCELLED')`,
    ),
    check('donor_requests_screening_index_check', sql`screening_index >= 0`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Conversation, events, outbox, jobs                                          */
/* -------------------------------------------------------------------------- */

/**
 * Resumable onboarding: **progress lives in the database, not process memory**
 * (§5). Nothing in `draft` is committed to `donors` until the final step, so an
 * abandoned interview leaves no half-donor behind.
 */
export const conversationState = botSchema.table(
  'conversation_state',
  {
    id: uuid('id').primaryKey(),
    channel: text('channel').notNull(),
    channelUserId: text('channel_user_id').notNull(),
    flow: text('flow').notNull(),
    step: text('step').notNull(),
    draft: jsonb('draft').notNull().default({}),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One conversation per person per platform.
    uniqueIndex('conversation_state_identity_idx').on(table.channel, table.channelUserId),
    index('conversation_state_expiry_idx').on(table.expiresAt),
  ],
);

/** Append-only state transitions (§2.9). The bot's half of the audit trail. */
export const eventLog = botSchema.table(
  'event_log',
  {
    id: uuid('id').primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    event: text('event').notNull(),
    /** Ties one unit of blood end to end, across both processes (§14). */
    correlationId: text('correlation_id'),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (table) => [
    index('event_log_subject_idx').on(table.subjectType, table.subjectId, table.occurredAt.desc()),
    index('event_log_correlation_idx').on(table.correlationId),
  ],
);

export const OUTBOX_STATUSES = ['pending', 'sent', 'failed', 'abandoned'] as const;

/**
 * **The stand-down guarantee** (§7.6).
 *
 * The spec names "a demand closed without its stand-down messages sent" as the
 * failure this system must not have. So closing a demand does not call a chat
 * API — it inserts rows here, in the same transaction as the closure. A worker
 * drains them with retries, and `dedupe_key` makes redelivery harmless.
 *
 * The §11.9 alert is a query against this table: pending stand-downs older than
 * five minutes.
 */
export const messageOutbox = botSchema.table(
  'message_outbox',
  {
    id: uuid('id').primaryKey(),
    channel: text('channel').notNull(),
    channelUserId: text('channel_user_id').notNull(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    /** One message per reason per recipient. A replay writes nothing. */
    dedupeKey: text('dedupe_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('message_outbox_dedupe_idx').on(table.dedupeKey),
    // The drain's claim, and the backlog alert.
    index('message_outbox_pending_idx')
      .on(table.status, table.nextAttemptAt)
      .where(sql`status = 'pending'`),
    index('message_outbox_kind_idx').on(table.kind, table.status, table.createdAt),
    check(
      'message_outbox_status_check',
      sql`status IN ('pending', 'sent', 'failed', 'abandoned')`,
    ),
    check('message_outbox_attempts_check', sql`attempts >= 0`),
  ],
);

export const JOB_STATUSES = ['pending', 'running', 'done', 'failed'] as const;

/** The bot's own scheduled work (§5.7, §11.2). */
export const botJobs = botSchema.table(
  'bot_jobs',
  {
    id: uuid('id').primaryKey(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    lastError: text('last_error'),
    correlationId: text('correlation_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('bot_jobs_due_idx').on(table.status, table.runAt).where(sql`status = 'pending'`),
    check('bot_jobs_status_check', sql`status IN ('pending', 'running', 'done', 'failed')`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Relations                                                                   */
/* -------------------------------------------------------------------------- */

export const donorRelations = relations(donors, ({ many }) => ({
  channels: many(donorChannels),
  phones: many(donorPhones),
  consents: many(donorConsents),
  journeys: many(donorRequests),
}));

export const botRequestRelations = relations(botRequests, ({ many }) => ({
  journeys: many(donorRequests),
}));

export const donorRequestRelations = relations(donorRequests, ({ one }) => ({
  request: one(botRequests, {
    fields: [donorRequests.botRequestId],
    references: [botRequests.id],
  }),
  donor: one(donors, { fields: [donorRequests.donorId], references: [donors.id] }),
}));
