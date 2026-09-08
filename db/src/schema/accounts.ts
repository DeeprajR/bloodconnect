/**
 * Account lifecycle: invites, password resets, email changes, seals and the
 * email outbox (§5.3, §2.3, §3).
 *
 * Four one-live-at-a-time tables with the same shape, deliberately. An invite,
 * an OTP and an email-change confirmation are all "a single-use secret sent to
 * an address, valid for a while, superseded by a newer one" — so they share a
 * partial unique index on `(user_id) WHERE consumed_at IS NULL AND
 * superseded_at IS NULL`, which makes "only one live at a time" a database
 * constraint rather than something the application remembers to enforce.
 *
 * None of them stores the secret. Only its hash goes in a column, so a database
 * dump is not a set of working links.
 */

import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { hospitalSchema, users } from './platform.js';

/* -------------------------------------------------------------------------- */
/* Invites (§2.3)                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The admin creates the account; the invite is how the person first gets in.
 *
 * There is no password field on account creation and the admin never knows one
 * (§2.3) — setting it happens here, on a link only the recipient's inbox has.
 */
export const accountInvites = hospitalSchema.table(
  'account_invites',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    /** Set when a re-send replaces this one, so the old link dies (§15). */
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    sentBy: uuid('sent_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('account_invites_token_hash_idx').on(table.tokenHash),
    // One live invite per account. A re-send supersedes rather than adding a
    // second working link (§2.3).
    uniqueIndex('account_invites_one_live_idx')
      .on(table.userId)
      .where(sql`consumed_at IS NULL AND superseded_at IS NULL`),
    // An invite that was never used ages visibly in the admin list (§8); this
    // is the index that finds them.
    index('account_invites_ageing_idx').on(table.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Password reset (§3)                                                         */
/* -------------------------------------------------------------------------- */

export const passwordResetOtps = hospitalSchema.table(
  'password_reset_otps',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Six digits, hashed. Short-lived, single-use, and never stored in clear. */
    otpHash: text('otp_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    /** Too many wrong guesses invalidates it, like an expiry (§3). */
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('password_reset_otps_one_live_idx')
      .on(table.userId)
      .where(sql`consumed_at IS NULL AND superseded_at IS NULL`),
    check('password_reset_otps_attempts_check', sql`attempts >= 0`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Email change — confirmed by the doctor, not by an admin                     */
/* -------------------------------------------------------------------------- */

/**
 * A doctor changing their own address confirms it themselves.
 *
 * This replaces the admin-approved update queue of §3 for the email field, and
 * it is the stronger of the two: an admin queue proves only that an
 * administrator agreed, whereas a link delivered to the proposed address proves
 * the person actually holds it. Both addresses are notified either way, so an
 * unauthorised change is visible to the person losing the account rather than
 * silent.
 *
 * The old address is stored so the notice can be sent after the change applies,
 * and so the audit trail says what it was without joining to a history table.
 */
export const emailChangeRequests = hospitalSchema.table(
  'email_change_requests',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    currentEmail: text('current_email').notNull(),
    newEmail: text('new_email').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('email_change_requests_token_hash_idx').on(table.tokenHash),
    uniqueIndex('email_change_requests_one_live_idx')
      .on(table.userId)
      .where(sql`consumed_at IS NULL AND superseded_at IS NULL AND cancelled_at IS NULL`),
    check('email_change_requests_distinct_check', sql`new_email <> current_email`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Stored objects (§3, §12.3)                                                  */
/* -------------------------------------------------------------------------- */

export const OBJECT_KINDS = ['seal', 'frame'] as const;
export type ObjectKind = (typeof OBJECT_KINDS)[number];

/**
 * One row per stored object, so retention (§12.3) is a query rather than a
 * bucket crawl, and so an object can be found from the database alone.
 */
export const objectRefs = hospitalSchema.table(
  'object_refs',
  {
    id: uuid('id').primaryKey(),
    bucket: text('bucket').notNull(),
    key: text('key').notNull(),
    contentType: text('content_type').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    kind: text('kind').notNull(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    /** Null means keep until something else decides; a date means a job deletes it. */
    deleteAfter: timestamp('delete_after', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('object_refs_location_idx').on(table.bucket, table.key),
    index('object_refs_retention_idx').on(table.deleteAfter),
    index('object_refs_owner_idx').on(table.ownerId, table.kind),
    check('object_refs_kind_check', sql`kind IN ('seal', 'frame')`),
    check('object_refs_size_check', sql`byte_size > 0`),
  ],
);

/** The doctor's seal, if they have uploaded one. */
export const userSeals = hospitalSchema.table(
  'user_seals',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    objectRefId: uuid('object_ref_id')
      .notNull()
      .references(() => objectRefs.id),
    uploadedBy: uuid('uploaded_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

/* -------------------------------------------------------------------------- */
/* Email outbox (§5.3, §7.6)                                                   */
/* -------------------------------------------------------------------------- */

export const EMAIL_KINDS = [
  'invite',
  'invite_resent',
  'password_otp',
  'password_changed',
  'email_change_confirm',
  'email_change_notice',
  'account_deactivated',
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export const EMAIL_STATUSES = [
  'queued',
  'sent',
  'delivered',
  'bounced',
  'complained',
  'failed',
] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

/**
 * **An outbox, not a log written after the fact.**
 *
 * The row is inserted in the same transaction as the thing that caused it, so
 * an account can never exist without its invite queued — the failure mode being
 * an account created, the email provider timing out, and nobody ever finding
 * out the person was never told (§7.6 applies the same reasoning to the bot's
 * stand-down message).
 *
 * A separate drain sends them and records the outcome.
 */
export const emailDeliveries = hospitalSchema.table(
  'email_deliveries',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    /**
     * Captured at queue time rather than joined at send time. An email about an
     * address change must go to the address that was current when it was
     * queued, not whatever the row says by the time the drain runs.
     */
    toAddress: text('to_address').notNull(),
    templateVersion: text('template_version').notNull(),
    status: text('status').notNull().default('queued'),
    providerMessageId: text('provider_message_id'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    /** Template variables. Never a password, a token or an OTP in clear. */
    payload: jsonb('payload').notNull().default({}),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('email_deliveries_drain_idx').on(table.status, table.nextAttemptAt),
    index('email_deliveries_user_idx').on(table.userId, table.createdAt),
    check(
      'email_deliveries_status_check',
      sql`status IN ('queued', 'sent', 'delivered', 'bounced', 'complained', 'failed')`,
    ),
    check(
      'email_deliveries_kind_check',
      sql`kind IN ('invite', 'invite_resent', 'password_otp', 'password_changed', 'email_change_confirm', 'email_change_notice', 'account_deactivated')`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* Relations                                                                   */
/* -------------------------------------------------------------------------- */

export const accountInviteRelations = relations(accountInvites, ({ one }) => ({
  user: one(users, { fields: [accountInvites.userId], references: [users.id] }),
}));

export const passwordResetOtpRelations = relations(passwordResetOtps, ({ one }) => ({
  user: one(users, { fields: [passwordResetOtps.userId], references: [users.id] }),
}));

export const emailChangeRequestRelations = relations(emailChangeRequests, ({ one }) => ({
  user: one(users, { fields: [emailChangeRequests.userId], references: [users.id] }),
}));

export const userSealRelations = relations(userSeals, ({ one }) => ({
  user: one(users, { fields: [userSeals.userId], references: [users.id] }),
  object: one(objectRefs, {
    fields: [userSeals.objectRefId],
    references: [objectRefs.id],
  }),
}));
