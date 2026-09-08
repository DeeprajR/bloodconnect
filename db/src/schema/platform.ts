/**
 * The `hospital` schema, platform tables (§5.3).
 *
 * Accounts, sessions, throttling, audit and configuration — the things every
 * module needs and none of them owns. `platform` may never know what a blood
 * request is (§2).
 */

import { relations, sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { locationNodes } from './reference.js';

export const hospitalSchema = pgSchema('hospital');

/**
 * `citext` for email: case-insensitive comparison in the column type rather
 * than at every call site, so "A@x.com" cannot become a second account for the
 * same person (§5.3).
 */
const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

/** The four roles (§2.2). There is no sign-up page; accounts are provisioned. */
export const USER_ROLES = ['doctor', 'admin', 'blood_centre', 'volunteer_admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['pending_activation', 'active', 'deactivated'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const users = hospitalSchema.table(
  'users',
  {
    id: uuid('id').primaryKey(),
    email: citext('email').notNull(),
    fullName: text('full_name').notNull(),
    role: text('role').notNull(),
    /** Medical registration number, where the role has one. */
    provisionalReg: text('provisional_reg'),
    /** Scopes a volunteer admin to one district; null means all (§6). */
    districtScopeId: text('district_scope_id').references(() => locationNodes.id),
    status: text('status').notNull().default('pending_activation'),
    /**
     * Null until the invite is consumed. The admin who creates an account never
     * knows a password because at that moment none exists (§2.3).
     */
    passwordHash: text('password_hash'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_email_idx').on(table.email),
    // Only where present: most roles have no registration number, and NULLs
    // must not collide with each other.
    uniqueIndex('users_provisional_reg_idx')
      .on(table.provisionalReg)
      .where(sql`provisional_reg IS NOT NULL`),
    // The last-active-admin check counts on this (§13).
    index('users_role_status_idx').on(table.role, table.status),
    check('users_role_check', sql`role IN ('doctor', 'admin', 'blood_centre', 'volunteer_admin')`),
    check(
      'users_status_check',
      sql`status IN ('pending_activation', 'active', 'deactivated')`,
    ),
    // An account that can sign in has a password; one that cannot, does not.
    check(
      'users_activation_check',
      sql`(status = 'pending_activation') = (password_hash IS NULL)`,
    ),
    // Only a volunteer admin is district-scoped (§6).
    check(
      'users_district_scope_check',
      sql`district_scope_id IS NULL OR role = 'volunteer_admin'`,
    ),
  ],
);

export const sessions = hospitalSchema.table(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * SHA-256 of the cookie value; the value itself is never stored (§3). A
     * database dump does not hand anyone a live session.
     */
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_idx').on(table.tokenHash),
    // A password reset revokes every session for the account (§3), and this is
    // the index that walk does.
    index('sessions_live_by_user_idx').on(table.userId).where(sql`revoked_at IS NULL`),
  ],
);

export const sessionRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

/**
 * Login and OTP throttling, in the database (§3, §13).
 *
 * In the database rather than in memory, so the limit survives a restart and
 * applies across every replica — an attacker who can trigger a redeploy must
 * not get a fresh allowance. The login and OTP throttles deliberately share
 * this table (§5.3).
 */
export const AUTH_RATE_LIMIT_SCOPES = [
  'login_ip',
  'login_account',
  'otp_ip',
  'otp_account',
] as const;
export type AuthRateLimitScope = (typeof AUTH_RATE_LIMIT_SCOPES)[number];

export const authRateLimits = hospitalSchema.table(
  'auth_rate_limits',
  {
    scope: text('scope').notNull(),
    /** The IP or the lowercased email — never a user id, which we may not know. */
    key: text('key').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('auth_rate_limits_window_idx').on(table.scope, table.key, table.windowStart),
    check(
      'auth_rate_limits_scope_check',
      sql`scope IN ('login_ip', 'login_account', 'otp_ip', 'otp_account')`,
    ),
  ],
);

/**
 * The audit log (§2.9, §14).
 *
 * Append-only, enforced by a missing grant: migration 0004 revokes UPDATE and
 * DELETE from `app_web`. A log the application can rewrite is not a log.
 */
export const ACTOR_KINDS = ['user', 'device', 'system', 'bot'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const auditLog = hospitalSchema.table(
  'audit_log',
  {
    id: uuid('id').primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    /** Null for a system or device actor; the kind says which. */
    actorUserId: uuid('actor_user_id').references(() => users.id),
    actorKind: text('actor_kind').notNull(),
    action: text('action').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    /** Ties every write in one request or job run together (§14). */
    correlationId: text('correlation_id').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (table) => [
    index('audit_log_subject_idx').on(table.subjectType, table.subjectId, table.occurredAt),
    index('audit_log_correlation_idx').on(table.correlationId),
    check('audit_log_actor_kind_check', sql`actor_kind IN ('user', 'device', 'system', 'bot')`),
    // A user actor has an id; a system or device actor does not.
    check(
      'audit_log_actor_check',
      sql`(actor_kind = 'user') = (actor_user_id IS NOT NULL)`,
    ),
  ],
);

/**
 * Clinical thresholds as rows (§12). Every change is audited, and the shape is
 * validated by `packages/config` rather than by this table.
 */
export const appConfig = hospitalSchema.table(
  'app_config',
  {
    key: text('key').primaryKey(),
    value: jsonb('value').notNull(),
    updatedBy: uuid('updated_by').references(() => users.id),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

/**
 * Kept for the boot-time assertion in §6: both processes compare their compiled
 * `CONTRACT_VERSION` against the stored one and refuse to start on a mismatch.
 */
export const isContractVersionKey = (key: string): boolean => key === 'contract.version';

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
}));

/** Exported for the seed and for tests that assert the enum matches the CHECK. */
export const PLATFORM_ENUMS = {
  USER_ROLES,
  USER_STATUSES,
  AUTH_RATE_LIMIT_SCOPES,
  ACTOR_KINDS,
} as const;
