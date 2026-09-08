/**
 * The four state machines, as transition tables (§3).
 *
 * Each is a discriminated union plus its legal edges as **data**, so a new state
 * breaks the build everywhere it must be handled rather than silently falling
 * through a switch. Nothing here decides *who* may make a transition — for the
 * two shared tables that is `packages/contract`, which scopes these same edges
 * by writer (§6).
 *
 * A transition table is not a suggestion: every status change in the system is a
 * conditional UPDATE guarded on the status it expects (§7.4), and these tables
 * are what those guards are written from.
 */

/** A transition table: for each state, the states it may legally move to. */
export type Transitions<S extends string> = Readonly<Record<S, readonly S[]>>;

export function canTransition<S extends string>(
  table: Transitions<S>,
  from: S,
  to: S,
): boolean {
  return table[from].includes(to);
}

/** States with nowhere left to go. Useful for "is this flow finished?" queries. */
export function terminalStates<S extends string>(table: Transitions<S>): S[] {
  return (Object.keys(table) as S[]).filter((state) => table[state].length === 0);
}

export const isTerminal = <S extends string>(table: Transitions<S>, state: S): boolean =>
  table[state].length === 0;

/* -------------------------------------------------------------------------- */
/* 1. Blood request (§3, §8)                                                   */
/* -------------------------------------------------------------------------- */

export const BLOOD_REQUEST_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'partially_approved',
  'declined',
  'cancelled',
] as const;
export type BloodRequestStatus = (typeof BLOOD_REQUEST_STATUSES)[number];

export const bloodRequestTransitions: Transitions<BloodRequestStatus> = {
  // An abandoned draft ages visibly on the dashboard and is never auto-deleted
  // (§8), so there is no edge out of a draft other than submitting it.
  draft: ['submitted'],
  submitted: ['approved', 'partially_approved', 'declined', 'cancelled'],
  approved: [],
  partially_approved: [],
  declined: [],
  cancelled: [],
};

/**
 * Overdue is **derived**, never stored (§3): a request is overdue when its
 * required day has passed and no decision exists. A stored flag would need a
 * job, and a request that becomes overdue at 00:01 must read as overdue at
 * 00:01 — not whenever the sweep next runs.
 */
export const isRequestDecided = (status: BloodRequestStatus): boolean =>
  status === 'approved' || status === 'partially_approved' || status === 'declined';

/* -------------------------------------------------------------------------- */
/* 2. Bag lifecycle (§3, §4)                                                   */
/* -------------------------------------------------------------------------- */

export const BAG_STATUSES = [
  'available',
  'reserved',
  'issued',
  'returned',
  'quarantined',
  'discarded',
  'expired',
  'lost',
] as const;
export type BagStatus = (typeof BAG_STATUSES)[number];

export const bagTransitions: Transitions<BagStatus> = {
  available: ['reserved', 'quarantined', 'discarded', 'expired', 'lost'],
  // reserved -> available is the release a cancelled request performs (§8);
  // without it a cancelled request would strand its units on the shelf.
  reserved: ['issued', 'available', 'quarantined', 'lost'],
  issued: ['returned', 'lost'],
  returned: ['available', 'quarantined', 'discarded'],
  quarantined: ['available', 'discarded'],
  // An expired unit is still physically present and still needs a disposal
  // route (§12.1), so expired is not the end of the bag — discarded is.
  expired: ['discarded'],
  discarded: [],
  lost: [],
};

/* -------------------------------------------------------------------------- */
/* 3. Demand (§3, §7)                                                          */
/* -------------------------------------------------------------------------- */

export const DEMAND_STATUSES = [
  'open',
  'fulfilled',
  'completed',
  'cancelled',
  'expired',
] as const;
export type DemandStatus = (typeof DEMAND_STATUSES)[number];

/**
 * A demand closes exactly one way of four — completed, cancelled, expired, or
 * fulfilled then completed (§5) — and whichever it is, the closure fans out the
 * stand-down messages in the same pass (§7.6).
 */
export const demandTransitions: Transitions<DemandStatus> = {
  open: ['fulfilled', 'cancelled', 'expired'],
  fulfilled: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  expired: [],
};

export const isDemandClosed = (status: DemandStatus): boolean =>
  isTerminal(demandTransitions, status);

/* -------------------------------------------------------------------------- */
/* 4. Donor journey (§5) — one row per donor per request                       */
/* -------------------------------------------------------------------------- */

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
export type DonorJourneyStatus = (typeof DONOR_JOURNEY_STATUSES)[number];

export const donorJourneyTransitions: Transitions<DonorJourneyStatus> = {
  // A donor who accepts a request that has just filled is waitlisted rather
  // than made to answer six questions for a place that no longer exists (§5).
  NOTIFIED: ['ACCEPTED', 'DECLINED', 'REQUEST_FILLED', 'CANCELLED'],
  ACCEPTED: ['SCREENING', 'CANCELLED'],
  // SCREENING -> REQUEST_FILLED is the loser of the last-unit race (§7.3):
  // they passed screening, the conditional UPDATE matched no row, so they are
  // waitlisted rather than turned away.
  SCREENING: ['CONFIRMED', 'DEFERRED', 'REQUEST_FILLED', 'CANCELLED'],
  // A waitlist that never resolves is worse than never offering one (§5), so
  // this state has exactly two exits and both of them tell the donor.
  REQUEST_FILLED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['COMPLETED', 'NO_SHOW', 'CANCELLED'],
  DECLINED: [],
  DEFERRED: [],
  COMPLETED: [],
  NO_SHOW: [],
  CANCELLED: [],
};

/**
 * The states a demand closure must stand down (§7.6). Everyone here was told
 * something and is still waiting to hear how it ended; leaving one out is the
 * failure the outbox exists to prevent.
 */
export const STANDS_DOWN_ON_CLOSURE = [
  'NOTIFIED',
  'ACCEPTED',
  'SCREENING',
  'CONFIRMED',
  'REQUEST_FILLED',
] as const satisfies readonly DonorJourneyStatus[];

export const needsStandDown = (status: DonorJourneyStatus): boolean =>
  (STANDS_DOWN_ON_CLOSURE as readonly DonorJourneyStatus[]).includes(status);
