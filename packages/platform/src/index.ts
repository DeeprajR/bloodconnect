/**
 * The platform module's only entry point (§2).
 *
 * Accounts, sessions, authorization, audit, email and configuration. Another
 * module imports from here and never from a path inside — the boundary check in
 * CI proves it.
 *
 * `platform` must never know what a blood request is. Nothing exported below
 * mentions one, and if something ever needs to, it belongs in `hospital`.
 *
 * Both applications import this package: the staff app and the administration
 * app are separate deployments over one set of accounts (§1).
 */

export {
  ADMIN_ROUTE_RULES,
  PERMISSIONS,
  ROLES_BY_AUDIENCE,
  STAFF_ROUTE_RULES,
  accessFor,
  actorHas,
  anonymousActor,
  audienceFor,
  decideAccess,
  isSameOrigin,
  landingFor,
  permissionsFor,
  roleHas,
  systemActor,
  type AccessDecision,
  type Actor,
  type Audience,
  type Permission,
  type RouteAccess,
  type UserRole,
} from './domain/authorization.js';

export {
  OTP_LENGTH,
  checkPassword,
  isLinkUsable,
  isOtpUsable,
  isOtpShaped,
  isPlausibleEmail,
  normaliseEmail,
} from './domain/credentials.js';

export {
  type PasswordHasher,
  type PlatformPorts,
  type RequestMetadata,
  type TokenGenerator,
  type TransactionContext,
  type UseCaseContext,
} from './context.js';

export {
  accountNotFound,
  emailTaken,
  invalidCredentials,
  lastAdministrator,
  linkNotUsable,
  notAuthorized,
  otpNotAccepted,
  passwordTooShort,
  rateLimited,
  sealRejected,
  sessionInvalid,
  type AccountLifecycleError,
  type PlatformError,
} from './errors.js';

export { db, schema, type Database, type Transaction } from './db.js';

export { argon2Hasher, nodeTokens, safeEqual } from './adapters/crypto.js';
export { createMemoryStorage, s3Storage } from './adapters/s3.js';
export {
  MAX_SEAL_BYTES,
  checkPng,
  type StoragePort,
} from './ports/storage.js';
export { createMemoryEmailPort, smtpEmailPort } from './adapters/smtp.js';
export { TEMPLATE_VERSION, renderEmail, type EmailPort } from './ports/email.js';

export { currentConfig, invalidateConfigCache, loadConfig } from './repositories/config.js';

export {
  findAccountById,
  findAccountByEmail,
  type AccountRow,
} from './repositories/accounts.js';

export { createAuditWriter, type AuditEntry, type AuditWriter } from './repositories/audit.js';

export {
  countStuckEmails,
  drainEmailOutbox,
  type DrainResult,
} from './repositories/email-outbox.js';

export {
  SESSION_TTL_HOURS,
  signIn,
  type SignInError,
  type SignInSuccess,
} from './use-cases/sign-in.js';

export { resolveActor, revokeAllSessions, signOut } from './use-cases/sessions.js';

export {
  cancelPendingEmailChange,
  confirmEmailChange,
  consumeInvite,
  requestEmailChange,
  requestPasswordOtp,
  verifyOtpAndReset,
} from './use-cases/account.js';

export {
  createDoctor,
  getDoctor,
  listDoctors,
  resendInvite,
  setAccountStatus,
  setDoctorEmail,
  updateDoctor,
  type DoctorDetail,
  type DoctorSummary,
} from './use-cases/doctors.js';

export {
  readSeal,
  removeSeal,
  uploadSeal,
  type SealUpload,
} from './use-cases/seals.js';
