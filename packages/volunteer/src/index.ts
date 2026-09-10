/**
 * Module 4's only entry point (§2, §6).
 *
 * The volunteer dashboard and the public board. It owns no table and holds no
 * use case, because it changes nothing: §8's flow index gives this module one
 * flow with one way out. Read it, copy a message, leave nothing behind.
 *
 * It may import `platform` for the context and `domain` for the rules. It may
 * not import `hospital`, `centre` or `bot`: what it knows arrives on the two
 * shared tables of §7, which is the same door the bot uses and the reason
 * Module 4 could be split into its own deployment without an archaeology
 * project (§11.2).
 */

export {
  UNSCOPED,
  asBloodGroup,
  demandsForGroup,
  groupPressure,
  publicBoard,
  trend,
  type DemandLine,
  type GroupPressure,
  type PublicDemandRow,
  type Scope,
  type TrendPoint,
} from './read.js';

export { scopeFor } from './scope.js';
