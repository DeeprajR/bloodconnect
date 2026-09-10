import type { RouteMetric, SurfaceMetric } from '@blood-connect/ops';

/**
 * Counters and latency, split the way §11.9 asks for (§11.9).
 *
 * Per surface first, because "which application is unhappy" is the question an
 * operator has before they have any others. Then per route, because "the API is
 * slow" and "one route returns 500 for one role" need different answers, and a
 * single average hides the second inside the first.
 *
 * p50 beside p95 rather than a mean. A mean over a long tail describes nobody's
 * experience; the p95 is where the person waiting actually lives.
 */

const SURFACE_WORDS: Record<string, string> = {
  staff: 'Staff app',
  admin: 'Administration',
  device: 'Device API',
  demand_api: 'Demand API',
  chat: 'Chat adapter',
};

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

export function MetricsTables({
  surfaces,
  routes,
  statuses,
}: {
  surfaces: readonly SurfaceMetric[];
  routes: readonly RouteMetric[];
  statuses: readonly { statusClass: string; count: number }[];
}) {
  if (surfaces.length === 0) {
    return (
      <div className="ux4g-alert ux4g-alert-info" role="status">
        <div className="ux4g-alert-content">
          <p className="ux4g-alert-message">
            Nothing served in the window yet. Rows appear as the applications are used.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-stack-tight">
      <p className="ux4g-body-s-default">
        {statuses.map((entry) => (
          <span className="app-board-chip app-figure" key={entry.statusClass}>
            {entry.statusClass} {entry.count}
          </span>
        ))}
      </p>

      <div className="app-scroll-x">
        <table className="ux4g-table">
          <caption className="app-sr-only">Traffic per surface, last 24 hours</caption>
          <thead>
            <tr>
              <th scope="col">Surface</th>
              <th scope="col">Requests</th>
              <th scope="col">Errors</th>
              <th scope="col">Error rate</th>
              <th scope="col">p50</th>
              <th scope="col">p95</th>
            </tr>
          </thead>
          <tbody>
            {surfaces.map((row) => (
              <tr key={row.surface}>
                <th scope="row">{SURFACE_WORDS[row.surface] ?? row.surface}</th>
                <td className="app-figure">{row.requests}</td>
                <td className="app-figure">{row.errors}</td>
                <td className="app-figure">
                  {row.errors > 0 ? (
                    <span className="ux4g-badge-digit-danger">{percent(row.errorRate)}</span>
                  ) : (
                    percent(row.errorRate)
                  )}
                </td>
                <td className="app-figure">{row.p50Ms}ms</td>
                <td className="app-figure">{row.p95Ms}ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="app-scroll-x">
        <table className="ux4g-table">
          <caption className="app-sr-only">
            Traffic per route, busiest first, last 24 hours
          </caption>
          <thead>
            <tr>
              <th scope="col">Route</th>
              <th scope="col">Surface</th>
              <th scope="col">Requests</th>
              <th scope="col">Errors</th>
              <th scope="col">p50</th>
              <th scope="col">p95</th>
              <th scope="col">Slowest</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((row) => (
              <tr key={`${row.surface}-${row.route}`}>
                <th scope="row" className="app-figure">
                  {row.route}
                </th>
                <td>{SURFACE_WORDS[row.surface] ?? row.surface}</td>
                <td className="app-figure">{row.requests}</td>
                <td className="app-figure">
                  {row.errors > 0 ? (
                    <span className="ux4g-badge-digit-danger">{row.errors}</span>
                  ) : (
                    row.errors
                  )}
                </td>
                <td className="app-figure">{row.p50Ms}ms</td>
                <td className="app-figure">{row.p95Ms}ms</td>
                <td className="app-figure">{row.maxMs}ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
