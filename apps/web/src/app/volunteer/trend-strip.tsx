import type { TrendPoint } from '@blood-connect/volunteer';

/**
 * Units asked for against units met, by week (§6).
 *
 * Shown lightly, and deliberately so. §6 calls this the only place
 * aggregate history appears anywhere in the system, and a volunteer wants
 * one thing from it: is the effort working? A chart with axes would
 * invite the second question, which is a report, and a report about
 * blood belongs to the centre.
 *
 * Bars are proportional, and every bar also carries its two numbers,
 * because §11.10 does not stop applying when a thing looks like a graph.
 */
export function TrendStrip({
  points,
  group,
}: {
  points: readonly TrendPoint[];
  group: string;
}) {
  if (points.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No history for {group} in the last six weeks.
      </p>
    );
  }

  const peak = Math.max(1, ...points.map((point) => point.unitsRequired));

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-ink">Last six weeks</h3>

      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Units needed and units met per week, for {group}
          </caption>
          <thead>
            <tr className="border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-ink-subtle">
              <th scope="col" className="px-4 py-2 text-left font-semibold">
                Week of
              </th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">
                Needed
              </th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">
                Met
              </th>
              <th scope="col" className="w-[40%] px-4 py-2 font-semibold">
                <span className="sr-only">Proportion met</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr
                key={point.weekStart}
                className="border-b border-border last:border-0"
              >
                <th
                  scope="row"
                  className="px-4 py-2.5 text-left align-middle font-normal tabular-nums text-ink"
                >
                  {point.weekStart}
                </th>
                <td className="px-4 py-2.5 text-right align-middle tabular-nums text-ink">
                  {point.unitsRequired}
                </td>
                <td className="px-4 py-2.5 text-right align-middle tabular-nums text-ink">
                  {point.unitsMet}
                </td>
                <td className="px-4 py-2.5 align-middle">
                  <span
                    className="block h-2 rounded-full bg-border"
                    style={{
                      inlineSize: `${String((point.unitsRequired / peak) * 100)}%`,
                    }}
                  >
                    <span
                      className="block h-full rounded-full bg-success"
                      style={{
                        inlineSize: `${String(
                          point.unitsRequired === 0
                            ? 0
                            : Math.min(
                                100,
                                (point.unitsMet / point.unitsRequired) * 100,
                              ),
                        )}%`,
                      }}
                    />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
