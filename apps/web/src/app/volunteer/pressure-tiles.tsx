import Link from 'next/link';

import { PRESSURE_LABELS, type PressureLevel } from '@blood-connect/domain';
import type { GroupPressure } from '@blood-connect/volunteer';

import { cn } from '@blood-connect/ui';

/**
 * The eight tiles that are the whole dashboard (§6).
 *
 * **Colour and number and label, never colour alone.** §6 says so and
 * §11.10 says so, and this is the screen where it matters most: a
 * volunteer reads it on a cheap phone in daylight, and the colour is the
 * first thing daylight takes. Every tile carries the group, a word for
 * the state, and the count. Any one of the three is enough to act on.
 *
 * The tiles are the navigation. Tapping one is how a volunteer gets to
 * the demands behind it, so each is a link and each has a target big
 * enough for a thumb.
 */

const LEVEL_CLASSES: Readonly<Record<PressureLevel, string>> = {
  met: 'border-success/40 bg-success-soft',
  recruiting: 'border-info/40 bg-info-soft',
  short: 'border-warning/40 bg-warning-soft',
  critical: 'border-danger/40 bg-danger-soft',
};

const LEVEL_STATE_CLASSES: Readonly<Record<PressureLevel, string>> = {
  met: 'text-success',
  recruiting: 'text-info',
  short: 'text-warning',
  critical: 'text-danger',
};

const LEVEL_SWATCHES: Readonly<Record<PressureLevel, string>> = {
  met: 'bg-success',
  recruiting: 'bg-info',
  short: 'bg-warning',
  critical: 'bg-danger',
};

export function PressureTiles({
  tiles,
  selected,
}: {
  tiles: readonly GroupPressure[];
  selected: string | null;
}) {
  return (
    <ul className="grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-4">
      {tiles.map((tile) => (
        <li key={tile.bloodGroup}>
          <Link
            href={`/volunteer?group=${encodeURIComponent(tile.bloodGroup)}`}
            aria-current={selected === tile.bloodGroup ? 'true' : undefined}
            className={cn(
              'flex h-full flex-col gap-1 rounded-card border-2 p-3 transition-colors',
              LEVEL_CLASSES[tile.level],
              'hover:bg-surface',
              selected === tile.bloodGroup && 'ring-2 ring-primary ring-offset-2',
            )}
          >
            <span className="text-xl font-bold tabular-nums text-ink">
              {tile.bloodGroup}
            </span>

            <span className="text-2xl font-semibold tabular-nums text-ink">
              {tile.unitsOutstanding}
              <span className="ml-1 text-xs font-normal text-ink-muted">
                {tile.unitsOutstanding === 1 ? 'unit' : 'units'}
              </span>
            </span>

            <span
              className={cn(
                'text-xs font-medium uppercase tracking-wide',
                LEVEL_STATE_CLASSES[tile.level],
              )}
            >
              {PRESSURE_LABELS[tile.level]}
            </span>

            {/*
              The recruitment effort, said quietly. "Nobody yet" beside
              twelve donors messaged means something different from
              "nobody yet" beside none, and a volunteer deciding where to
              spend an evening needs the difference.
            */}
            <span className="text-xs text-ink-muted">{noteFor(tile)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function noteFor(tile: GroupPressure): string {
  if (tile.belowFloor && tile.unitsOutstanding === 0) return 'Shelf below floor';
  if (tile.unitsOutstanding === 0) return 'Nothing outstanding';

  const messaged = `${String(tile.donorsNotified)} messaged`;
  if (tile.unitsConfirmed === 0) return messaged;
  return `${String(tile.unitsConfirmed)} confirmed · ${messaged}`;
}

/** The key beside the tiles, so the colours are readable as a scale. */
export function PressureLegend({ levels }: { levels: readonly PressureLevel[] }) {
  return (
    <ul className="flex list-none flex-wrap gap-3 p-0 text-xs text-ink-muted">
      {levels.map((level) => (
        <li className="flex items-center gap-1.5" key={level}>
          <span
            className={cn('size-2.5 rounded-full', LEVEL_SWATCHES[level])}
            aria-hidden="true"
          />
          <span>{PRESSURE_LABELS[level]}</span>
        </li>
      ))}
    </ul>
  );
}
