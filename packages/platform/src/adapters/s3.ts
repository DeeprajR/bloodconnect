import { createHash } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import type { StoragePort, StoredObject } from '../ports/storage.js';

/**
 * S3-compatible object storage, pointed at MinIO in development (§10).
 *
 * Path-style addressing, because MinIO on `localhost:9000` has no per-bucket
 * DNS. The bucket is private and nothing here ever produces a public URL.
 * Objects are read back through an authenticated route.
 */

let client: S3Client | undefined;

const getClient = (): S3Client => {
  client ??= new S3Client({
    region: process.env['S3_REGION'] ?? 'ap-south-1',
    endpoint: process.env['S3_ENDPOINT'] ?? 'http://localhost:9000',
    forcePathStyle: process.env['S3_FORCE_PATH_STYLE'] !== 'false',
    credentials: {
      accessKeyId: process.env['S3_ACCESS_KEY_ID'] ?? 'minioadmin',
      secretAccessKey: process.env['S3_SECRET_ACCESS_KEY'] ?? 'minioadmin',
    },
  });
  return client;
};

const bucket = (): string => process.env['S3_BUCKET'] ?? 'blood-connect';

export const s3Storage: StoragePort = {
  /**
   * `HeadBucket`, which is what §11.9 asks for.
   *
   * One call that exercises the network, the credentials and the bucket's
   * existence together, and writes nothing. A read of a missing key would have
   * been cheaper and would have proved nothing: `get` returns undefined for a
   * dead server and for an absent object alike.
   */
  async verify(): Promise<{ ok: boolean; detail: string }> {
    try {
      await getClient().send(new HeadBucketCommand({ Bucket: bucket() }));
      return { ok: true, detail: `Bucket ${bucket()} answered.` };
    } catch (error: unknown) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  },

  async put(key: string, body: Uint8Array, contentType: string): Promise<StoredObject> {
    const sha256 = createHash('sha256').update(body).digest('hex');

    await getClient().send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: key,
        Body: body,
        ContentType: contentType,
        // Recorded on the object as well as in `object_refs`, so a bucket
        // audit can verify the database without re-reading every byte.
        ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
      }),
    );

    return { bucket: bucket(), key, contentType, byteSize: body.byteLength, sha256 };
  },

  async get(key: string): Promise<Uint8Array | undefined> {
    try {
      const result = await getClient().send(
        new GetObjectCommand({ Bucket: bucket(), Key: key }),
      );
      const bytes = await result.Body?.transformToByteArray();
      return bytes ?? undefined;
    } catch {
      // A missing object is not an error here: the caller renders a placeholder
      // rather than a stack trace.
      return undefined;
    }
  },

  async remove(key: string): Promise<void> {
    await getClient().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
  },
};

/** In-memory storage, for tests and for a run where nothing should be written. */
export function createMemoryStorage(): StoragePort & { readonly size: () => number } {
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();

  return {
    put(key: string, body: Uint8Array, contentType: string): Promise<StoredObject> {
      objects.set(key, { body, contentType });
      return Promise.resolve({
        bucket: 'memory',
        key,
        contentType,
        byteSize: body.byteLength,
        sha256: createHash('sha256').update(body).digest('hex'),
      });
    },
    get: (key: string) => Promise.resolve(objects.get(key)?.body),
    remove: (key: string) => {
      objects.delete(key);
      return Promise.resolve();
    },
    size: () => objects.size,
  };
}
