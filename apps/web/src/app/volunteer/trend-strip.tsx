import type { TrendPoint } from '@blood-connect/volunteer';

/**
 * Units asked for against units met, by week (§6).
 *
 * Shown lightly, and deliberately so. §6 calls this the only place aggregate
 * history appears anywhere in the system, and a volunteer wants one thing from
 * it: is the effort working? A chart with axes would invite the second
 * question, which is a report, and a report about blood belongs to the centre.
 *
 * Bars are proportional, and every bar also carries its two numbers, because
 * §11.10 does not stop applying when a thing looks like a graph.
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
      <p className="ux4g-label-m-default">
        No history for {group} in the last six weeks.
      </p>
    );
  }

  const peak = Math.max(1, ...points.map((point) => point.unitsRequired));

  return (
    <div className="app-stack-tight">
      <h3 className="ux4g-label-l-strong">Last six weeks</h3>

      <table className="ux4g-table app-trend">
        <caption className="app-sr-only">
          Units needed and units met per week, for {group}
        </caption>
        <thead>
          <tr>
            <th scope="col">Week of</th>
            <th scope="col">Needed</th>
            <th scope="col">Met</th>
            <th scope="col">
              <span className="app-sr-only">Proportion met</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.weekStart}>
              <th scope="row" className="app-figure">
                {point.weekStart}
              </th>
              <td className="app-figure">{point.unitsRequired}</td>
              <td className="app-figure">{point.unitsMet}</td>
              <td>
                <span
                  className="app-trend-track"
                  style={{ inlineSize: `${(point.unitsRequired / peak) * 100}%` }}
                >
                  <span
                    className="app-trend-met"
                    style={{
                      inlineSize: `${
                        point.unitsRequired === 0
                          ? 0
                          : Math.min(100, (point.unitsMet / point.unitsRequired) * 100)
                      }%`,
                    }}
                  />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
