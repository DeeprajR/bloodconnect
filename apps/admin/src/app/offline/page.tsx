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
    <div className="app-page">
      <main id="main" className="app-main app-main-narrow">
        <div className="ux4g-alert ux4g-alert-warning" role="status">
          <div className="ux4g-alert-content">
            <h1 className="ux4g-alert-title">You are offline</h1>
            <p className="ux4g-alert-message">
              Blood Connect needs a connection. Nothing is shown from a stored copy,
              because stock figures and request statuses are only safe when they come
              from the server.
            </p>
          </div>
        </div>
        <p className="ux4g-body-s-default">Reconnect and reload this page.</p>
      </main>
    </div>
  );
}
