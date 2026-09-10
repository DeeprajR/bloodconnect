/**
 * Object storage (§3, §4, §10).
 *
 * Private buckets, streamed through authenticated routes, never a public URL.
 * A seal is a doctor's signature block; a URL that works without a session is a
 * signature anyone can lift.
 */

export type StoredObject = {
  readonly bucket: string;
  readonly key: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly sha256: string;
};

export type StoragePort = {
  /**
   * Prove the bucket is there and the credentials still work.
   *
   * Separate from `get`, and it has to be. `get` swallows every error on
   * purpose, because a missing seal renders a placeholder rather than a stack
   * trace, and that makes it useless as a health check: a bucket that has been
   * deleted and a key that was never written are indistinguishable through it.
   *
   * Optional, because an in-memory store has nothing to reach.
   */
  readonly verify?: () => Promise<{ ok: boolean; detail: string }>;
  readonly put: (
    key: string,
    body: Uint8Array,
    contentType: string,
  ) => Promise<StoredObject>;
  readonly get: (key: string) => Promise<Uint8Array | undefined>;
  readonly remove: (key: string) => Promise<void>;
};

/* -------------------------------------------------------------------------- */
/* PNG validation                                                              */
/* -------------------------------------------------------------------------- */

/** PNG only, 1 MB or smaller (§3). */
export const MAX_SEAL_BYTES = 1024 * 1024;

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type PngCheck =
  | { readonly ok: true; readonly width: number; readonly height: number }
  | { readonly ok: false; readonly reason: 'not_png' | 'malformed' };

/**
 * Verifies the bytes really are a PNG, and that nothing is hidden after them.
 *
 * §3 asks for the upload to be re-encoded server-side, which is the thorough
 * answer to a polyglot file, one that is a valid PNG *and* a valid script,
 * depending on who parses it. Re-encoding needs a native image library, so
 * this does the affordable part of the same job: it checks the signature, walks
 * the chunk structure, reads the real dimensions, and rejects any trailing byte
 * after IEND, which is where a polyglot's second payload lives.
 *
 * The remaining gap is recorded as debt rather than pretended away, and the
 * serving route sends `nosniff` with an explicit content type so a browser
 * never reinterprets it.
 */
export function checkPng(bytes: Uint8Array): PngCheck {
  if (bytes.length < 8 + 25) return { ok: false, reason: 'not_png' };

  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return { ok: false, reason: 'not_png' };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let sawHeader = false;

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const typeStart = offset + 4;
    const dataStart = typeStart + 4;

    // length + type + data + crc
    const next = dataStart + length + 4;
    if (length > bytes.length || next > bytes.length) return { ok: false, reason: 'malformed' };

    const type = String.fromCharCode(
      bytes[typeStart] ?? 0,
      bytes[typeStart + 1] ?? 0,
      bytes[typeStart + 2] ?? 0,
      bytes[typeStart + 3] ?? 0,
    );

    if (!sawHeader) {
      // The first chunk of a PNG must be IHDR; anything else is not one.
      if (type !== 'IHDR' || length !== 13) return { ok: false, reason: 'malformed' };
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      if (width === 0 || height === 0) return { ok: false, reason: 'malformed' };
      if (width > 8000 || height > 8000) return { ok: false, reason: 'malformed' };
      sawHeader = true;
    }

    if (type === 'IEND') {
      // Nothing may follow the end marker. Trailing bytes are the signature of
      // a file pretending to be two things at once.
      return next === bytes.length
        ? { ok: true, width, height }
        : { ok: false, reason: 'malformed' };
    }

    offset = next;
  }

  // Ran out of bytes without reaching an IEND chunk.
  return { ok: false, reason: 'malformed' };
}
