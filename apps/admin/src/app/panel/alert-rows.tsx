import type { Alert } from '@blood-connect/domain';

/**
 * The silent-failure board (§11.9).
 *
 * Each row links to the record, so the panel is a way in rather than a dead
 * end. Most of what it reports about lives in the staff application on a
 * different origin (§1), so the link is absolute and the row says which
 * application it is sending you to. An operator following a link at 3am should
 * not discover they needed a second sign-in only after clicking.
 *
 * An empty board is stated rather than shown as an absence. "Nothing is
 * waiting" and "this section failed to load" look identical when both render
 * as blank space, and the difference is the whole point of the screen.
 */

const staffOrigin = (): string =>
  process.env['STAFF_APP_URL']?.replace(/\/+$/, '') ?? 'http://localhost:3000';

const LEVEL_WORDS = {
  critical: 'Somebody is waiting',
  warning: 'Today',
  info: 'For information',
} as const;

function age(seconds: number | null): string {
  if (seconds === null) return '';
  if (seconds < 3600) return `oldest ${String(Math.floor(seconds / 60))} minutes`;
  if (seconds < 86_400) return `oldest ${String(Math.floor(seconds / 3600))} hours`;
  return `oldest ${String(Math.floor(seconds / 86_400))} days`;
}

export function AlertRows({
  alerts,
  gaps,
}: {
  alerts: readonly Alert[];
  gaps: readonly string[];
}) {
  return (
    <div className="app-stack-tight">
      {gaps.map((gap) => (
        <div className="ux4g-alert ux4g-alert-warning" role="status" key={gap}>
          <div className="ux4g-alert-content">
            <p className="ux4g-alert-message">{gap}</p>
          </div>
        </div>
      ))}

      {alerts.length === 0 ? (
        <div className="ux4g-alert ux4g-alert-success" role="status">
          <div className="ux4g-alert-content">
            <p className="ux4g-alert-message">
              Nothing is waiting on anybody. Every queue is empty and every hold is
              inside its window.
            </p>
          </div>
        </div>
      ) : (
        <ul className="app-stack-tight app-plain-list">
          {alerts.map((alert) => {
            const href =
              alert.href === undefined
                ? undefined
                : alert.app === 'staff'
                  ? `${staffOrigin()}${alert.href}`
                  : alert.href;

            return (
              <li key={alert.kind}>
                <div className={`app-alert app-alert-${alert.level}`}>
                  <div className="app-row-split">
                    <span className="app-alert-title">{alert.title}</span>
                    <span className="app-alert-count app-figure">{alert.count}</span>
                  </div>
                  <p className="app-alert-meta">
                    {LEVEL_WORDS[alert.level]}
                    {alert.oldestAgeSeconds === null ? '' : ` · ${age(alert.oldestAgeSeconds)}`}
                  </p>
                  <p className="app-alert-todo">{alert.whatToDo}</p>
                  {href ? (
                    <a className="ux4g-btn ux4g-btn-outline-primary ux4g-btn-md app-target" href={href}>
                      {alert.app === 'staff' ? 'Open in the staff app' : 'Open'}
                    </a>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
