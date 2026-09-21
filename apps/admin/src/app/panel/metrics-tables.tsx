import { DataTable, EmptyState, StatusBadge, type Column } from '@blood-connect/ui';
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
      <EmptyState
        title="Nothing served in the window yet."
        description="Rows appear as the applications are used."
      />
    );
  }

  const surfaceColumns: Column<SurfaceMetric>[] = [
    {
      key: 'surface',
      header: 'Surface',
      cell: (r) => SURFACE_WORDS[r.surface] ?? r.surface,
    },
    { key: 'requests', header: 'Requests', align: 'right', cell: (r) => <span className="tabular-nums">{r.requests}</span> },
    { key: 'errors', header: 'Errors', align: 'right', cell: (r) => <span className="tabular-nums">{r.errors}</span> },
    {
      key: 'errorRate',
      header: 'Error rate',
      align: 'right',
      cell: (r) =>
        r.errors > 0 ? (
          <StatusBadge label={percent(r.errorRate)} tone="danger" />
        ) : (
          <span className="tabular-nums">{percent(r.errorRate)}</span>
        ),
    },
    { key: 'p50', header: 'p50', align: 'right', cell: (r) => <span className="tabular-nums">{r.p50Ms}ms</span> },
    { key: 'p95', header: 'p95', align: 'right', cell: (r) => <span className="tabular-nums">{r.p95Ms}ms</span> },
  ];

  const routeColumns: Column<RouteMetric>[] = [
    {
      key: 'route',
      header: 'Route',
      cell: (r) => <span className="font-mono text-xs">{r.route}</span>,
    },
    {
      key: 'surface',
      header: 'Surface',
      cell: (r) => SURFACE_WORDS[r.surface] ?? r.surface,
      hideOnMobile: true,
    },
    { key: 'requests', header: 'Requests', align: 'right', cell: (r) => <span className="tabular-nums">{r.requests}</span> },
    {
      key: 'errors',
      header: 'Errors',
      align: 'right',
      cell: (r) =>
        r.errors > 0 ? (
          <StatusBadge label={String(r.errors)} tone="danger" />
        ) : (
          <span className="tabular-nums">{r.errors}</span>
        ),
    },
    { key: 'p50', header: 'p50', align: 'right', cell: (r) => <span className="tabular-nums">{r.p50Ms}ms</span> },
    { key: 'p95', header: 'p95', align: 'right', cell: (r) => <span className="tabular-nums">{r.p95Ms}ms</span> },
    { key: 'max', header: 'Slowest', align: 'right', cell: (r) => <span className="tabular-nums">{r.maxMs}ms</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {statuses.map((entry) => (
          <span
            key={entry.statusClass}
            className="inline-flex items-center gap-1.5 rounded-control border border-border bg-surface-muted px-2.5 py-1 text-xs font-semibold text-ink"
          >
            <span className="tabular-nums">
              {entry.statusClass} {entry.count}
            </span>
          </span>
        ))}
      </div>

      <DataTable
        columns={surfaceColumns}
        rows={[...surfaces]}
        getRowKey={(r) => r.surface}
        caption="Traffic per surface, last 24 hours"
      />

      <DataTable
        columns={routeColumns}
        rows={[...routes]}
        getRowKey={(r) => `${r.surface}-${r.route}`}
        caption="Traffic per route, busiest first, last 24 hours"
      />
    </div>
  );
}
