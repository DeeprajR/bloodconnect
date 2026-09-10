/**
 * The other half of the metrics (§11.9).
 *
 * `notePage` records a render that finished. A render that threw never reaches
 * it, and those are exactly the rows an operator most wants to see, so the
 * framework's own error hook records them instead.
 *
 * **Node only, and split into a second file to keep it that way.** Next bundles
 * this module for the Edge runtime as well, where a native module cannot load:
 * importing the database layer directly from here broke every page in the app
 * with a resolution error for Argon2's WASM build. The dynamic import behind
 * the runtime check is Next's documented shape for exactly this.
 */

export function register(): void {
  // Nothing to start. Present because Next expects it alongside the hook below.
}

export async function onRequestError(
  _error: unknown,
  request: { path?: string; method?: string },
): Promise<void> {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return;

  try {
    const { recordFailedRender } = await import('./lib/record-failure');
    await recordFailedRender('staff', request);
  } catch {
    // Recording a failure must never become a second failure.
  }
}
