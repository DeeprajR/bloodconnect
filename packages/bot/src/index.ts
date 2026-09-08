/**
 * Module 3's only entry point (§2).
 *
 * The donor bot: onboarding, waves, screening, confirmation, and the endings.
 * It may import the shared packages; it must never import `hospital` or
 * `centre`, and it reaches the two shared contract tables on granted columns
 * only — everything else in `hospital` is a permission error, not a convention.
 */

export { createBotDatabase, type BotDatabase, type BotTransaction } from './db.js';
export { createBotConfigCache, loadBotConfig } from './config.js';
export type { BotContext, BotTransactionContext } from './context.js';

export { createChannelRegistry } from './ports/channel.js';
export {
  type ChannelAddress,
  type ChannelPort,
  type ChannelRegistry,
  type Choice,
  type IncomingUpdate,
  type OutgoingMessage,
  type SendResult,
} from './ports/channel.js';

export { createMemoryChannel, type MemoryChannel } from './adapters/memory-channel.js';
export { TELEGRAM_CHANNEL, createTelegramChannel, type TelegramOptions } from './adapters/telegram.js';

export { MESSAGES, WORDING_VERSION, readableDay, type HospitalSnapshot } from './messages.js';
export {
  QUESTION_COUNT,
  SCREENING_QUESTIONS,
  defersOn,
  durableAnswersFrom,
  isPermanentDeferral,
  questionAt,
  type ScreeningQuestion,
} from './screening.js';

export { createEventWriter, type BotEvent, type EventWriter } from './events.js';

export {
  MAX_ATTEMPTS,
  MESSAGE_KINDS,
  countStuckStandDowns,
  drainOutbox,
  enqueue,
  type DrainResult,
  type MessageKind,
  type QueuedMessage,
} from './outbox.js';

export { handleUpdate } from './conversation.js';
export { standingFor, unaskedRequestsFor, type DonorStanding, type OpenNeed } from './use-cases/needs.js';
export { tick, type TickResult } from './ticker.js';

export {
  importOpenDemands,
  makePublicId,
  writeBackProgress,
  type ImportedRequest,
} from './use-cases/import-demand.js';

export {
  findRequestsDueAWave,
  isEligible,
  selectWave,
  sendWave,
  type DonorForEligibility,
  type WaveDonor,
  type WaveResult,
} from './use-cases/waves.js';

export {
  acceptRequest,
  answerScreeningQuestion,
  declineRequest,
  promoteFromWaitlist,
  type JourneyError,
  type ScreeningStep,
} from './use-cases/journey.js';

export {
  closeDemand,
  findCancelledDemands,
  findExpiredDemands,
  type CloseResult,
  type ClosureReason,
} from './use-cases/close-demand.js';

export {
  applyCounterOutcomes,
  findCompletedRequests,
  type OutcomeResult,
} from './use-cases/outcomes.js';

export {
  DRAFT_TTL_HOURS,
  ONBOARDING_STEPS,
  advanceOnboarding,
  beginOnboarding,
  deleteDonorData,
  findDonorByAddress,
  loadState,
  optOutDonor,
  promptFor,
  resumeDonor,
  snoozeDonor,
  type OnboardingDraft,
  type OnboardingStep,
} from './use-cases/onboarding.js';

export { applyWalkIns, type WalkInSyncResult } from './use-cases/walk-ins.js';
