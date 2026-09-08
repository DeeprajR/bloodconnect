import { NextResponse } from 'next/server';

import { readSeal, s3Storage } from '@blood-connect/platform';

import { requireAccess, useCaseContext } from '@/lib/guards';

/**
 * Serves a doctor's seal to a signed-in administrator (§3, §13).
 *
 * Never a public URL. The route re-checks access itself rather than trusting
 * the proxy, and sends `nosniff` with an explicit content type so a browser
 * cannot reinterpret the bytes as anything but an image.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const actor = await requireAccess(`/api/seal/${id}`);
  const ctx = await useCaseContext(actor);

  const seal = await readSeal(ctx, s3Storage, id);
  if (!seal) return new NextResponse('Not found', { status: 404 });

  return new NextResponse(Buffer.from(seal.bytes), {
    headers: {
      'Content-Type': seal.contentType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      // A signature is not something to leave in a shared cache.
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
