/**
 * The doctor's seal (§3, §8.1).
 *
 * A seal is a signature block that appears on a blood request. It is stored in
 * a private bucket and served only through an authenticated route — never by a
 * public URL, because a signature anyone can fetch is a signature anyone can
 * reuse.
 */

import { eq } from 'drizzle-orm';
import { err, ok, type Result } from '@blood-connect/result';
import { objectRefs, userSeals } from '@blood-connect/db';

import type { UseCaseContext } from '../context.js';
import { actorHas } from '../domain/authorization.js';
import {
  accountNotFound,
  notAuthorized,
  sealRejected,
  type AccountNotFound,
  type NotAuthorized,
  type SealRejected,
} from '../errors.js';
import { findAccountById } from '../repositories/accounts.js';
import { createAuditWriter } from '../repositories/audit.js';
import { MAX_SEAL_BYTES, checkPng, type StoragePort } from '../ports/storage.js';

export type SealUpload = {
  readonly bytes: Uint8Array;
  readonly contentType: string;
};

export type UploadSealError = NotAuthorized | AccountNotFound | SealRejected;

/**
 * Validates, stores, and records — in that order.
 *
 * The object goes to storage before the row is written, so a committed
 * `object_refs` row always points at something that exists. The reverse order
 * would leave the database describing an object that was never uploaded, which
 * is the harder failure to detect: a broken image rather than an orphaned byte
 * range a retention sweep can find.
 */
export async function uploadSeal(
  ctx: UseCaseContext,
  storage: StoragePort,
  userId: string,
  upload: SealUpload,
): Promise<Result<{ objectId: string }, UploadSealError>> {
  const isSelf = ctx.actor.kind === 'user' && ctx.actor.userId === userId;
  if (!isSelf && !actorHas(ctx.actor, 'doctors:manage')) {
    return err(notAuthorized('doctors:manage'));
  }

  if (upload.bytes.byteLength > MAX_SEAL_BYTES) return err(sealRejected('too_large'));

  // The declared content type is the client's claim; the bytes are the fact.
  const png = checkPng(upload.bytes);
  if (!png.ok) return err(sealRejected(png.reason));

  const now = ctx.clock.now();
  const account = await findAccountById(ctx.db, userId);
  if (!account) return err(accountNotFound());

  const objectId = ctx.ids.next<'ObjectRefId'>();
  // Keyed by the generated id, never by anything the uploader supplies — a
  // filename is attacker-controlled and a key is a path.
  const key = `seals/${userId}/${objectId}.png`;

  const stored = await storage.put(key, upload.bytes, 'image/png');

  return ctx.db.transaction(async (tx) => {
    await tx.insert(objectRefs).values({
      id: objectId,
      bucket: stored.bucket,
      key: stored.key,
      contentType: stored.contentType,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      kind: 'seal',
      ownerId: userId,
    });

    // One seal per doctor: a new upload replaces the reference. The old object
    // stays in the bucket with its row, so a request already carrying it can
    // still render, and retention removes it later (§12.3).
    await tx
      .insert(userSeals)
      .values({
        userId,
        objectRefId: objectId,
        uploadedBy: ctx.actor.kind === 'user' ? ctx.actor.userId : null,
      })
      .onConflictDoUpdate({
        target: userSeals.userId,
        set: {
          objectRefId: objectId,
          uploadedBy: ctx.actor.kind === 'user' ? ctx.actor.userId : null,
        },
      });

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({
      action: 'account.seal_uploaded',
      subjectType: 'user',
      subjectId: userId,
      metadata: {
        objectId,
        byteSize: stored.byteSize,
        width: png.width,
        height: png.height,
      },
    });

    return ok({ objectId });
  });
}

export async function removeSeal(
  ctx: UseCaseContext,
  userId: string,
): Promise<Result<Record<string, never>, NotAuthorized>> {
  const isSelf = ctx.actor.kind === 'user' && ctx.actor.userId === userId;
  if (!isSelf && !actorHas(ctx.actor, 'doctors:manage')) {
    return err(notAuthorized('doctors:manage'));
  }

  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    // Only the reference is dropped. The object and its row survive so that a
    // request already signed with it still renders, and so a mistaken removal
    // is recoverable — the bucket is not where deletions should be irreversible.
    await tx.delete(userSeals).where(eq(userSeals.userId, userId));

    const audit = createAuditWriter(tx, ctx.actor, ctx.correlationId, now);
    await audit({ action: 'account.seal_removed', subjectType: 'user', subjectId: userId });

    return ok({});
  });
}

export type SealBytes = {
  readonly bytes: Uint8Array;
  readonly contentType: string;
};

/**
 * Reads a seal for an authenticated viewer.
 *
 * The authorization is the caller's to make before calling — the route that
 * serves this is role-guarded, and this returns nothing rather than throwing
 * when the object has gone, so a missing file renders a placeholder.
 */
export async function readSeal(
  ctx: UseCaseContext,
  storage: StoragePort,
  userId: string,
): Promise<SealBytes | undefined> {
  const [row] = await ctx.db
    .select({ key: objectRefs.key, contentType: objectRefs.contentType })
    .from(userSeals)
    .innerJoin(objectRefs, eq(objectRefs.id, userSeals.objectRefId))
    .where(eq(userSeals.userId, userId));

  if (!row) return undefined;

  const bytes = await storage.get(row.key);
  if (!bytes) return undefined;

  return { bytes, contentType: row.contentType };
}
