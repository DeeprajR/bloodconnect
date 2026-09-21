import { StatusBadge } from '@blood-connect/ui';
import type { Heartbeat, HealthTile } from '@blood-connect/ops';

/**
 * The dependency tiles (§11.9).
 *
 * Every tile carries the word, the detail and what to do, in that order. §11.9
 * puts it plainly: a red tile that does not say what broke is a pager that
 * wakes somebody up for nothing. So the instruction is on every tile, not only
 * the failing ones, and the detail on a failure is the driver's own message
 * rather than a paraphrase of it.
 *
 * Colour is never the only signal here either. The status word sits next to the
 * colour, which matters more on this screen than most: it is read on a phone,
 * at night, by somebody who has just been woken up.
 */

const timeFormat = new Intl.DateTimeFormat('en-IN', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
});

const STATUS_WORDS = {
  ok: 'Working',
  degraded: 'Degraded',
  down: 'Down',
} as const;

const STATUS_TONES = {
  ok: 'success',
  degraded: 'warning',
  down: 'danger',
} as const;

const EDGE = {
  ok: 'border-l-success',
  degraded: 'border-l-warning',
  down: 'border-l-danger',
} as const;

function age(seconds: number | null): string {
  if (seconds === null) return 'never';
  if (seconds < 60) return `${String(seconds)}s ago`;
  if (seconds < 3600) return `${String(Math.floor(seconds / 60))}m ago`;
  if (seconds < 86_400) return `${String(Math.floor(seconds / 3600))}h ago`;
  return `${String(Math.floor(seconds / 86_400))}d ago`;
}

export function HealthTiles({
  tiles,
  heartbeats,
}: {
  tiles: readonly HealthTile[];
  heartbeats: readonly Heartbeat[];
}) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tiles.map((tile) => (
        <li
          key={tile.dependency}
          className={`flex flex-col gap-1 rounded-card border border-border border-l-4 bg-surface p-4 shadow-card ${EDGE[tile.status]}`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-ink">{tile.label}</span>
            <StatusBadge label={STATUS_WORDS[tile.status]} tone={STATUS_TONES[tile.status]} />
          </div>
          <p className="text-sm text-ink-muted">{tile.detail}</p>
          <p className="text-sm text-ink-muted">{tile.whatToDo}</p>
          <p className="mt-1 text-xs tabular-nums text-ink-subtle">
            {timeFormat.format(tile.checkedAt)} · {tile.latencyMs}ms
          </p>
        </li>
      ))}

      {heartbeats.map((beat) => (
        <li
          key={beat.process}
          className={`flex flex-col gap-1 rounded-card border border-border border-l-4 bg-surface p-4 shadow-card ${beat.stale ? EDGE.down : EDGE.ok}`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-ink">
              {beat.process === 'bot' ? 'Donor bot' : 'Web release'}
            </span>
            <StatusBadge
              label={beat.stale ? 'Silent' : 'Reporting'}
              tone={beat.stale ? 'danger' : 'success'}
            />
          </div>
          <p className="text-sm text-ink-muted">
            {/*
              The age, always. This is the one tile whose usefulness is
              entirely in its timestamp: a bot that has stopped keeps whatever
              it last said, and only the age gives that away.
            */}
            Last heard {age(beat.ageSeconds)}
            {beat.contractVersion ? `, on contract ${beat.contractVersion}` : ''}
            {beat.buildId ? `, build ${beat.buildId}` : ''}
          </p>
          <p className="text-sm text-ink-muted">
            {beat.stale
              ? 'Nothing on this page about that process is current. Check its host is running.'
              : 'Nothing to do.'}
          </p>
          <p className="mt-1 text-xs tabular-nums text-ink-subtle">
            {beat.observedAt ? timeFormat.format(beat.observedAt) : 'no heartbeat yet'}
          </p>
        </li>
      ))}
    </ul>
  );
}
