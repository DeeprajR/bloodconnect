import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Offline · Blood Connect' };

/**
 * What the service worker serves when a navigation cannot reach the server
 * (§2.8).
 *
 * It carries no data, and that is the point. The alternative, a cached copy of
 * whatever page was last viewed, would show a stock figure, a request status
 * or somebody else's dashboard, all of which are wrong in a way that matters
 * clinically. Saying "you are offline" is the honest answer.
 *
 * Rendered statically so it can be cached at install time and needs no session.
 */
export const dynamic = 'force-static';

export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-3 p-6">
        <div
          role="status"
          className="rounded-card border border-warning/30 bg-warning-soft p-6"
        >
          <h1 className="text-base font-semibold text-warning">You are offline</h1>
          <p className="mt-2 text-sm text-ink">
            Blood Connect needs a connection. Nothing is shown from a stored
            copy, because stock figures and request statuses are only safe
            when they come from the server.
          </p>
        </div>
        <p className="text-sm text-ink-muted">Reconnect and reload this page.</p>
      </main>
    </div>
  );
}
