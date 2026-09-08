/**
 * The platform module's only entry point (§2).
 *
 * Accounts, sessions, authorization, audit and configuration. Another module
 * imports from here and never from a path inside — the boundary check in CI
 * proves it.
 *
 * `platform` must never know what a blood request is. Nothing exported below
 * mentions one, and if something ever needs to, it belongs in `hospital`.
 */

export {
  ROUTE_RULES,
  accessFor,
  actorHas,
  anonymousActor,
  decideAccess,
  landingFor,
  permissionsFor,
  roleHas,
  systemActor,
  type AccessDecision,
  type Actor,
  type Permission,
  type RouteAccess,
  type UserRole,
} from './domain/authorization';

export {
  type PasswordHasher,
  type PlatformPorts,
  type RequestMetadata,
  type TokenGenerator,
  type TransactionContext,
  type UseCaseContext,
} from './context';

export {
  invalidCredentials,
  notAuthorized,
  passwordTooShort,
  rateLimited,
  sessionInvalid,
  type PlatformError,
} from './errors';

export { argon2Hasher, nodeTokens, safeEqual } from './adapters/crypto';

export { currentConfig, invalidateConfigCache, loadConfig } from './repositories/config';

export {
  findAccountById,
  findAccountByEmail,
  type AccountRow,
} from './repositories/accounts';

export { createAuditWriter, type AuditEntry, type AuditWriter } from './repositories/audit';

export { SESSION_TTL_HOURS, signIn, type SignInError, type SignInSuccess } from './use-cases/sign-in';

export { resolveActor, revokeAllSessions, signOut } from './use-cases/sessions';
