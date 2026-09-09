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
  DURABLE_QUESTIONS,
  QUESTION_COUNT,
  SCREENING_QUESTIONS,
  VISIT_QUESTIONS,
  defersOn,
  durableAnswersFrom,
  durableQuestionsFor,
  durableSummaryLines,
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
  tellUnansweredItIsCovered,
  type CloseResult,
  type CoveredResult,
  type ClosureReason,
} from './use-cases/close-demand.js';

export {
  applyCounterOutcomes,
  findCompletedRequests,
  type OutcomeResult,
} from './use-cases/outcomes.js';

export {
  DRAFT_TTL_HOURS,
  INTERVIEW_STEPS,
  STEP_LABELS,
  checklistMessage,
  isInterviewStep,
  maskPhone,
  promptFor,
  rowNumberOf,
  stepAtRow,
  summaryMessage,
  summaryRows,
  type FlowStep,
  type InterviewDraft,
  type InterviewState,
  type InterviewStep,
  type SummaryRow,
} from './use-cases/interview.js';

export {
  answerContact,
  answerInterview,
  beginInterview,
  clearInterview,
  loadInterview,
  type AnswerResult,
  type MatchableCheck,
} from './use-cases/interview-flow.js';

export {
  clearConversation,
  deleteDonorData,
  draftFromProfile,
  findDonorByAddress,
  optOutDonor,
  resumeDonor,
  snoozeDonor,
  type ErasureResult,
} from './use-cases/self-service.js';

export {
  LOCATION_LEVELS,
  describeLocation,
  hasChildren,
  levelBelow,
  listChildren,
  listDistricts,
  normalise,
  nodeById,
  searchChildren,
  type LocationLevel,
  type LocationNode,
} from './use-cases/location.js';

export { applyWalkIns, type WalkInSyncResult } from './use-cases/walk-ins.js';

export {
  journeyForBoardTap,
  openBoard,
  openCount,
  requestByPublicId,
  type Board,
  type BoardBlock,
  type BoardEntry,
} from './use-cases/board.js';

export {
  REMIND_AFTER_HOURS,
  remindAbandonedSignups,
  type ReminderResult,
} from './use-cases/reminders.js';
