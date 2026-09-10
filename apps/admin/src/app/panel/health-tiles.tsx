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
    <ul className="app-tiles app-plain-list">
      {tiles.map((tile) => (
        <li key={tile.dependency}>
          <div className={`app-health app-health-${tile.status}`}>
            <span className="app-health-label">{tile.label}</span>
            <span className="app-health-status">{STATUS_WORDS[tile.status]}</span>
            <span className="app-health-detail">{tile.detail}</span>
            <span className="app-health-todo">{tile.whatToDo}</span>
            <span className="app-health-meta app-figure">
              {timeFormat.format(tile.checkedAt)} · {tile.latencyMs}ms
            </span>
          </div>
        </li>
      ))}

      {heartbeats.map((beat) => (
        <li key={beat.process}>
          <div className={`app-health app-health-${beat.stale ? 'down' : 'ok'}`}>
            <span className="app-health-label">
              {beat.process === 'bot' ? 'Donor bot' : 'Web release'}
            </span>
            <span className="app-health-status">{beat.stale ? 'Silent' : 'Reporting'}</span>
            <span className="app-health-detail">
              {/*
                The age, always. This is the one tile whose usefulness is
                entirely in its timestamp: a bot that has stopped keeps whatever
                it last said, and only the age gives that away.
              */}
              Last heard {age(beat.ageSeconds)}
              {beat.contractVersion ? `, on contract ${beat.contractVersion}` : ''}
              {beat.buildId ? `, build ${beat.buildId}` : ''}
            </span>
            <span className="app-health-todo">
              {beat.stale
                ? 'Nothing on this page about that process is current. Check its host is running.'
                : 'Nothing to do.'}
            </span>
            <span className="app-health-meta app-figure">
              {beat.observedAt ? timeFormat.format(beat.observedAt) : 'no heartbeat yet'}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
