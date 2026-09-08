/**
 * The contract between the centre and the bot (§6, §7).
 *
 * Three tables in the `hospital` schema, and nothing else. The centre and the bot
 * integrate through these and no HTTP call in either direction (§1). Both
 * `apps/web` and `apps/bot` depend on this package; neither depends on the
 * other.
 *
 * §11.2 names a one-sided change to `donor_demand` as the single most likely way
 * this system breaks in production. So the ownership rules below are exported as
 * data and asserted mechanically in both codebases, rather than being a
 * convention someone is expected to remember during review.
 *
 * The database enforces the same thing independently, through column-level
 * UPDATE grants (§5.1): the bot physically cannot set `units`, and the centre
 * physically cannot set `confirmed_units`. This package is the second line of
 * defence and the readable one.
 */

import {
  BLOOD_GROUPS,
  DEMAND_STATUSES,
  PRODUCTS,
  demandTransitions as demandStateMachine,
  type DemandStatus,
  type Transitions,
} from '@blood-connect/domain';
import { z } from 'zod';

/**
 * Semver, asserted at boot by both processes against the value stored in
 * `app_config` (§6). Additive columns are a minor bump; anything else is major
 * and requires both sides shipped in the same release. A mismatched deploy is a
 * refused start, not silent corruption.
 */
export const CONTRACT_VERSION = '1.2.0';

export const CONTRACT_VERSION_CONFIG_KEY = 'contract.version';

export type ContractVersionCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly expected: string; readonly found: string; readonly reason: string };

/** Same major means both sides understand every column either one writes. */
export function checkContractVersion(found: string): ContractVersionCheck {
  const major = (v: string): string => v.split('.')[0] ?? '';
  if (found === CONTRACT_VERSION) return { ok: true };
  if (major(found) === major(CONTRACT_VERSION)) return { ok: true };
  return {
    ok: false,
    expected: CONTRACT_VERSION,
    found,
    reason:
      'major contract version mismatch — the centre and the bot must ship together for this change',
  };
}

/* -------------------------------------------------------------------------- */
/* donor_demand — centre to bot                                                */
/* -------------------------------------------------------------------------- */

export const DEMAND_TRIGGERS = ['request_shortfall', 'stock_floor'] as const;
export type DemandTrigger = (typeof DEMAND_TRIGGERS)[number];

const uuid = z.uuid();
const calendarDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const donorDemandRowSchema = z.object({
  id: uuid,
  centreId: uuid,

  /* --- written by the centre: what is needed --- */
  trigger: z.enum(DEMAND_TRIGGERS),
  /** Null for a `stock_floor` demand: it answers no single request. */
  bloodRequestId: uuid.nullable(),
  bloodGroup: z.enum(BLOOD_GROUPS),
  product: z.enum(PRODUCTS),
  units: z.number().int().positive(),
  dateRequired: calendarDay,

  /* --- written by the centre: what donors are told, snapshotted (§2.6) --- */
  hospitalName: z.string().min(1),
  hospitalAddress: z.string().min(1),
  districtId: z.string().min(1),
  cityId: z.string().min(1).nullable(),
  notes: z.string().nullable(),

  /* --- written by both --- */
  status: z.enum(DEMAND_STATUSES),

  /* --- written by the bot --- */
  /** The deep-link id. Null until the bot has imported the demand. */
  botPublicId: z.string().min(1).nullable(),
  importedAt: z.date().nullable(),
  donorsNotified: z.number().int().nonnegative(),
  confirmedUnits: z.number().int().nonnegative(),
  waitlistedUnits: z.number().int().nonnegative(),
  completedUnits: z.number().int().nonnegative(),

  createdAt: z.date(),
  updatedAt: z.date(),
});

export type DonorDemandRow = z.infer<typeof donorDemandRowSchema>;

/* -------------------------------------------------------------------------- */
/* donor_demand_confirmations — bot to centre to bot                           */
/* -------------------------------------------------------------------------- */

export const CONFIRMATION_STATUSES = [
  'confirmed',
  'completed',
  'no_show',
  'cancelled',
] as const;
export type ConfirmationStatus = (typeof CONFIRMATION_STATUSES)[number];

export const donorDemandConfirmationRowSchema = z.object({
  id: uuid,
  demandId: uuid,

  /**
   * The bot's **internal** donor id, not a platform user id (§7, §2.11). That is
   * what lets the same person be reached on Telegram today and WhatsApp
   * tomorrow without the centre's roster changing shape.
   */
  donorId: uuid,
  /** Carried alongside so the counter knows where the person was reached. */
  channel: z.string().min(1),

  /* --- written by the bot --- */
  donorName: z.string().min(1),
  donorPhone: z.string().min(1),
  bloodGroup: z.enum(BLOOD_GROUPS),
  confirmedAt: z.date(),
  /** Set once the donor has been updated and thanked. */
  acknowledgedAt: z.date().nullable(),

  /* --- written by both --- */
  status: z.enum(CONFIRMATION_STATUSES),

  /* --- written by the centre, at the counter --- */
  donatedAt: calendarDay.nullable(),
  bagIdentifier: z.string().min(1).nullable(),
  /**
   * The group the counter typed off the unit it collected (§4).
   *
   * Added in 1.1.0. It is what lets the bot mark a donor's group **verified** —
   * §7.7 recruits nobody whose group is only self-declared, the centre is the
   * authority on what a unit actually is, and it has no other way to say so.
   * Additive, so both sides understand each other across the bump.
   */
  donatedBloodGroup: z.enum(BLOOD_GROUPS).nullable(),
  markedBy: uuid.nullable(),

  createdAt: z.date(),
  updatedAt: z.date(),
});

export type DonorDemandConfirmationRow = z.infer<typeof donorDemandConfirmationRowSchema>;

/* -------------------------------------------------------------------------- */
/* walk_in_donations — centre to bot, one way                                  */
/* -------------------------------------------------------------------------- */

/**
 * Somebody who gave blood without ever being in the bot (§4).
 *
 * Added in 1.2.0, and the third table only because the second one refused to be
 * it: the centre holds **no INSERT** on `donor_demand_confirmations`, so a
 * walk-in recorded as a confirmation row was rejected by the database the first
 * time it ran as `app_web`. That is the split working, not a mistake in it — a
 * centre that could invent confirmations could inflate counters the bot owns.
 *
 * So the centre writes this, and the bot only reads it. The bot has to see it:
 * a unit already collected is a unit it must stop recruiting for, and a demand
 * covered by walk-ins that nobody told the bot about goes on calling real people
 * in for blood the shelf already has.
 */
export const walkInDonationRowSchema = z.object({
  id: uuid,
  demandId: uuid,

  /* --- written by the centre, all of it --- */
  donorName: z.string().min(1),
  donorPhone: z.string().min(1),
  /** The group the unit **typed as** — the only group anybody here measured. */
  bloodGroup: z.enum(BLOOD_GROUPS),
  bagIdentifier: z.string().min(1),
  donatedOn: calendarDay,
  recordedBy: uuid.nullable(),

  createdAt: z.date(),
});

export type WalkInDonationRow = z.infer<typeof walkInDonationRowSchema>;

export const WALK_IN_DONATION_COLUMNS = [
  'id',
  'demand_id',
  'donor_name',
  'donor_phone',
  'blood_group',
  'bag_identifier',
  'donated_on',
  'recorded_by',
  'created_at',
] as const;
export type WalkInDonationColumn = (typeof WALK_IN_DONATION_COLUMNS)[number];

/**
 * The bot writes none of it.
 *
 * Mirrors `GRANT SELECT ON hospital.walk_in_donations TO app_bot` — a read and
 * nothing else. The bot has no business recording who gave blood.
 */
export const canBotWriteWalkIn = (_column: WalkInDonationColumn): boolean => false;

/** The centre writes every column; nobody, itself included, rewrites one. */
export const canCentreWriteWalkIn = (column: WalkInDonationColumn): boolean =>
  (WALK_IN_DONATION_COLUMNS as readonly string[]).includes(column);

/* -------------------------------------------------------------------------- */
/* Column ownership (§7)                                                       */
/* -------------------------------------------------------------------------- */

export type Writer = 'centre' | 'bot';

/**
 * Column names in **storage form**, because that is what the grants in §5.1 and
 * the shared migration test compare against.
 */
export const DONOR_DEMAND_COLUMNS = [
  'id',
  'centre_id',
  'trigger',
  'blood_request_id',
  'blood_group',
  'product',
  'units',
  'date_required',
  'hospital_name',
  'hospital_address',
  'district_id',
  'city_id',
  'notes',
  'status',
  'bot_public_id',
  'imported_at',
  'donors_notified',
  'confirmed_units',
  'waitlisted_units',
  'completed_units',
  'created_at',
  'updated_at',
] as const;
export type DonorDemandColumn = (typeof DONOR_DEMAND_COLUMNS)[number];

/** Mirrors `GRANT UPDATE (...) ON hospital.donor_demand TO app_bot` exactly. */
const BOT_WRITABLE_DEMAND_COLUMNS = [
  'bot_public_id',
  'imported_at',
  'donors_notified',
  'confirmed_units',
  'waitlisted_units',
  'completed_units',
  'status',
  'updated_at',
] as const satisfies readonly DonorDemandColumn[];

/** The centre raises and cancels; everything describing the need is its own. */
const CENTRE_WRITABLE_DEMAND_COLUMNS = [
  'id',
  'centre_id',
  'trigger',
  'blood_request_id',
  'blood_group',
  'product',
  'units',
  'date_required',
  'hospital_name',
  'hospital_address',
  'district_id',
  'city_id',
  'notes',
  'status',
  'created_at',
  'updated_at',
] as const satisfies readonly DonorDemandColumn[];

export const DONOR_DEMAND_CONFIRMATION_COLUMNS = [
  'id',
  'demand_id',
  'donor_id',
  'channel',
  'donor_name',
  'donor_phone',
  'blood_group',
  'confirmed_at',
  'acknowledged_at',
  'status',
  'donated_at',
  'bag_identifier',
  'donated_blood_group',
  'marked_by',
  'created_at',
  'updated_at',
] as const;
export type DonorDemandConfirmationColumn =
  (typeof DONOR_DEMAND_CONFIRMATION_COLUMNS)[number];

/**
 * The bot creates the roster row, so it writes every column on INSERT; the
 * grant in §5.1 narrows what it may later UPDATE to these three. INSERT is a
 * whole-row grant in Postgres, which is exactly why this list is also asserted
 * in the contract tests rather than left to the database alone.
 */
const BOT_WRITABLE_CONFIRMATION_COLUMNS = [
  'id',
  'demand_id',
  'donor_id',
  'channel',
  'donor_name',
  'donor_phone',
  'blood_group',
  'confirmed_at',
  'acknowledged_at',
  'status',
  'created_at',
  'updated_at',
] as const satisfies readonly DonorDemandConfirmationColumn[];

/** What happened at the counter, and the status it produces. */
const CENTRE_WRITABLE_CONFIRMATION_COLUMNS = [
  'status',
  'donated_at',
  'bag_identifier',
  'donated_blood_group',
  'marked_by',
  'updated_at',
] as const satisfies readonly DonorDemandConfirmationColumn[];

export const canBotWrite = (column: DonorDemandColumn): boolean =>
  (BOT_WRITABLE_DEMAND_COLUMNS as readonly string[]).includes(column);

export const canCentreWrite = (column: DonorDemandColumn): boolean =>
  (CENTRE_WRITABLE_DEMAND_COLUMNS as readonly string[]).includes(column);

export const canBotWriteConfirmation = (
  column: DonorDemandConfirmationColumn,
): boolean => (BOT_WRITABLE_CONFIRMATION_COLUMNS as readonly string[]).includes(column);

export const canCentreWriteConfirmation = (
  column: DonorDemandConfirmationColumn,
): boolean => (CENTRE_WRITABLE_CONFIRMATION_COLUMNS as readonly string[]).includes(column);

/* -------------------------------------------------------------------------- */
/* Transitions, scoped by writer (§7)                                          */
/* -------------------------------------------------------------------------- */

/**
 * §7's table as data: which side may move which status where.
 *
 * The union of both sides is exactly the domain's demand state machine — an
 * invariant the contract tests assert, so an edge cannot be added to one without
 * being accounted for in the other.
 */
export const demandTransitions: Readonly<Record<Writer, Transitions<DemandStatus>>> = {
  // The centre withdraws a demand — including because the doctor cancelled the
  // underlying request. It never declares one fulfilled or complete: only the
  // bot knows whether donors turned up.
  centre: {
    open: ['cancelled'],
    fulfilled: ['cancelled'],
    completed: [],
    cancelled: [],
    expired: [],
  },
  // The bot owns recruitment progress and the two endings that come from it.
  bot: {
    open: ['fulfilled', 'expired'],
    fulfilled: ['completed'],
    completed: [],
    cancelled: [],
    expired: [],
  },
};

export const confirmationTransitions: Readonly<
  Record<Writer, Transitions<ConfirmationStatus>>
> = {
  // The bot creates the row in `confirmed` and never moves it again; what
  // happened on the day is the counter's to record.
  bot: { confirmed: [], completed: [], no_show: [], cancelled: [] },
  centre: {
    confirmed: ['completed', 'no_show', 'cancelled'],
    completed: [],
    no_show: [],
    cancelled: [],
  },
};

export function canWriterMoveDemand(
  writer: Writer,
  from: DemandStatus,
  to: DemandStatus,
): boolean {
  return demandTransitions[writer][from].includes(to);
}

export function canWriterMoveConfirmation(
  writer: Writer,
  from: ConfirmationStatus,
  to: ConfirmationStatus,
): boolean {
  return confirmationTransitions[writer][from].includes(to);
}

/** Re-exported so a contract test can assert the two tables agree (§6). */
export { demandStateMachine };

/**
 * The bot's poll (§7): open demands it has not yet imported. Kept here rather
 * than in the bot so the centre can see, in the shared package, exactly what its
 * writes make visible.
 */
export const isAwaitingImport = (
  row: Pick<DonorDemandRow, 'status' | 'botPublicId'>,
): boolean => row.status === 'open' && row.botPublicId === null;
