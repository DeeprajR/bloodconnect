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
  type DecideError,
  type RegisterBagError,
  type TagCase,
} from './errors.js';
