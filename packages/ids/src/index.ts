/**
 * Branded identifiers, UUIDv7 (§5.2).
 *
 * Time-ordered so index locality is good, and a key does not leak a count.
 * Branded in TypeScript so a `BagId` is not assignable to a `DemandId`. The
 * mistake this package exists to make unrepresentable.
 *
 * Ids are generated in application code, never by a column default, so a use
 * case knows the id before the row exists and can write audit and outbox rows
 * that reference it inside the same transaction.
 */

import { v7 as uuidv7, validate as uuidValidate, version as uuidVersion } from 'uuid';

declare const brand: unique symbol;

export type Branded<T, B extends string> = T & { readonly [brand]: B };

/** Every entity id in the system is a UUIDv7 string underneath. */
export type Uuid<B extends string> = Branded<string, B>;

export type UserId = Uuid<'UserId'>;
export type SessionId = Uuid<'SessionId'>;
export type InviteId = Uuid<'InviteId'>;
export type OtpId = Uuid<'OtpId'>;
export type UpdateRequestId = Uuid<'UpdateRequestId'>;
export type EmailDeliveryId = Uuid<'EmailDeliveryId'>;
export type AuditEntryId = Uuid<'AuditEntryId'>;
export type JobId = Uuid<'JobId'>;
export type ObjectRefId = Uuid<'ObjectRefId'>;

export type PatientId = Uuid<'PatientId'>;
export type AdmissionId = Uuid<'AdmissionId'>;
export type BloodRequestId = Uuid<'BloodRequestId'>;
export type BloodSampleId = Uuid<'BloodSampleId'>;

export type BagId = Uuid<'BagId'>;
export type TagAssignmentId = Uuid<'TagAssignmentId'>;
export type DecisionId = Uuid<'DecisionId'>;
export type DiscrepancyId = Uuid<'DiscrepancyId'>;
export type QuarantineId = Uuid<'QuarantineId'>;
export type DiscardId = Uuid<'DiscardId'>;
export type ReturnId = Uuid<'ReturnId'>;
export type DeviceId = Uuid<'DeviceId'>;
export type CalibrationId = Uuid<'CalibrationId'>;
export type RegionId = Uuid<'RegionId'>;
export type ObservationId = Uuid<'ObservationId'>;
export type ReconciliationId = Uuid<'ReconciliationId'>;

export type DemandId = Uuid<'DemandId'>;
export type ConfirmationId = Uuid<'ConfirmationId'>;

export type DonorId = Uuid<'DonorId'>;
export type BotRequestId = Uuid<'BotRequestId'>;
export type DonorRequestId = Uuid<'DonorRequestId'>;
export type ConversationId = Uuid<'ConversationId'>;
export type OutboxMessageId = Uuid<'OutboxMessageId'>;

/** Location nodes carry dataset-supplied ids (`KKD_T1_P05`), not UUIDs (§5.8). */
export type LocationNodeId = Branded<string, 'LocationNodeId'>;

/** A tag's UID comes off the tag itself; it is not ours to generate. */
export type TagUid = Branded<string, 'TagUid'>;

/**
 * An id generator, injected like the clock (§3): a use case never reaches for a
 * module-level `uuidv7()`, so a test can hand it a deterministic sequence.
 */
export type IdGenerator = { readonly next: <B extends string>() => Uuid<B> };

export const newId = <B extends string>(): Uuid<B> => uuidv7() as Uuid<B>;

export const idGenerator: IdGenerator = { next: newId };

/** True only for a well-formed version-7 UUID. A v4 is not acceptable here. */
export const isUuidV7 = (value: string): boolean =>
  uuidValidate(value) && uuidVersion(value) === 7;

/**
 * Parse at the edge (§3): turns unknown input into a branded id, or nothing.
 * Nothing downstream re-validates.
 */
export function parseId<B extends string>(value: unknown): Uuid<B> | undefined {
  return typeof value === 'string' && isUuidV7(value) ? (value as Uuid<B>) : undefined;
}

/** For seeds and tests, where a literal id is being asserted deliberately. */
export function unsafeId<B extends string>(value: string): Uuid<B> {
  if (!isUuidV7(value)) throw new Error(`not a UUIDv7: ${value}`);
  return value as Uuid<B>;
}

export const locationNodeId = (value: string): LocationNodeId => value as LocationNodeId;
export const tagUid = (value: string): TagUid => value as TagUid;
