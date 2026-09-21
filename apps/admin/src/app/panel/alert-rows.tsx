import { EmptyState, StatusBadge } from '@blood-connect/ui';
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

const LEVEL_TONES = {
  critical: 'danger',
  warning: 'warning',
  info: 'info',
} as const;

const EDGE = {
  critical: 'border-l-danger',
  warning: 'border-l-warning',
  info: 'border-l-info',
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
    <div className="space-y-3">
      {gaps.map((gap) => (
        <p
          key={gap}
          role="status"
          className="rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-ink"
        >
          {gap}
        </p>
      ))}

      {alerts.length === 0 ? (
        <EmptyState title="Nothing is waiting on anybody." description="Every queue is empty and every hold is inside its window." />
      ) : (
        <ul className="space-y-3">
          {alerts.map((alert) => {
            const href =
              alert.href === undefined
                ? undefined
                : alert.app === 'staff'
                  ? `${staffOrigin()}${alert.href}`
                  : alert.href;

            return (
              <li
                key={alert.kind}
                className={`rounded-card border border-border border-l-4 bg-surface p-4 shadow-card ${EDGE[alert.level]}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-sm font-semibold text-ink">{alert.title}</span>
                  <span className="text-xl font-semibold tabular-nums text-ink">
                    {alert.count}
                  </span>
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-subtle">
                  <StatusBadge label={LEVEL_WORDS[alert.level]} tone={LEVEL_TONES[alert.level]} />
                  {alert.oldestAgeSeconds === null ? '' : age(alert.oldestAgeSeconds)}
                </p>
                <p className="mt-2 text-sm text-ink-muted">{alert.whatToDo}</p>
                {href ? (
                  <a
                    href={href}
                    className="mt-3 inline-flex items-center justify-center gap-2 rounded-control border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink no-underline hover:bg-surface-muted"
                  >
                    {alert.app === 'staff' ? 'Open in the staff app' : 'Open'}
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
