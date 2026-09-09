/**
 * Module 2's only entry point (§2).
 *
 * The register, the decision, and demand. It may import `platform`, `hospital`
 * (through that module's own entry point, never its tables) and the shared
 * packages; nothing outside it may read `blood_bags`, `centre_decisions` or the
 * two contract tables.
 *
 * `boundary.test.ts` next to this file checks that in the only way that keeps
 * working: it reads this module's own source and fails if a Module 1 table name
 * appears in it.
 */

export { cancelRequest, type CancelResult } from './use-cases/cancel.js';

export {
  classifyTag,
  listOpenDiscrepancies,
  raiseTagDiscrepancy,
  releaseTag,
  resolveTag,
  resolveTagDiscrepancy,
  type DiscrepancyFinding,
  type DiscrepancyOutcome,
  type DiscrepancyRow,
  type ResolvedTag,
  type TagResolution,
} from './use-cases/tags.js';

export {
  allowedOutcomes,
  countOverdueQuarantine,
  defaultOutcome,
  discardBag,
  discardExpiredQuarantine,
  listQuarantine,
  resolveQuarantine,
  returnBag,
  returnTimeLimitMinutes,
  type QuarantineRow,
  type ReturnInput,
  type ReturnOutcome,
  type ReturnResult,
  type StorageBand,
} from './use-cases/returns.js';

export {
  countUnmarked,
  listCompletedDonations,
  listRoster,
  listUpcomingDonations,
  listWalkIns,
  markRosterOutcome,
  recordWalkIn,
  todaysUnits,
  type DonationRow,
  type MarkInput,
  type RosterOutcome,
  type RosterRow,
  type WalkInInput,
  type WalkInRow,
} from './use-cases/roster.js';

export {
  decideRequest,
  type DecisionAction,
  type DecisionInput,
  type DecisionResult,
} from './use-cases/decide.js';

export {
  cancelDemand,
  raiseDemand,
  readCentreSnapshot,
  recruitForFloor,
  type CentreSnapshot,
  type DemandInput,
  type FloorShortfall,
  type RecruitResult,
} from './use-cases/demand.js';

export {
  expireStaleBags,
  registerBag,
  type BagInput,
  type RegisterBagResult,
} from './use-cases/inventory.js';

export { setShelfLife, updateCentreSettings, type SettingsInput } from './use-cases/settings.js';

export {
  availableUnits,
  centreOverviewCounts,
  getCentreSettings,
  getDecisionForRequest,
  getDemand,
  getShelfLives,
  listBags,
  listDecisionBags,
  listDemands,
  stockByGroup,
  type BagFilter,
  type BagRow,
  type CentreSettingsRow,
  type DecisionRow,
  type DemandRow,
  type GroupStock,
} from './read.js';

export {
  demandNotFound,
  invalidBag,
  notEnoughStock,
  requestAlreadyDecided,
  requestNotDecidable,
  requestNotFound,
  settingsIncomplete,
  tagUnavailable,
  unitNumberTaken,
  type CancelRequestError,
  type DecideError,
  type RegisterBagError,
  type TagCase,
} from './errors.js';
