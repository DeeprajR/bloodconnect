import Link from 'next/link';

import { PRESSURE_LABELS, type PressureLevel } from '@blood-connect/domain';
import type { GroupPressure } from '@blood-connect/volunteer';

/**
 * The eight tiles that are the whole dashboard (§6).
 *
 * **Colour and number and label, never colour alone.** §6 says so and §11.10
 * says so, and this is the screen where it matters most: a volunteer reads it
 * on a cheap phone in daylight, and the colour is the first thing daylight
 * takes. Every tile carries the group, a word for the state, and the count.
 * Any one of the three is enough to act on.
 *
 * The tiles are the navigation. Tapping one is how a volunteer gets to the
 * demands behind it, so each is a link and each has a target big enough for a
 * thumb.
 */
export function PressureTiles({
  tiles,
  selected,
}: {
  tiles: readonly GroupPressure[];
  selected: string | null;
}) {
  return (
    <ul className="app-tiles app-plain-list">
      {tiles.map((tile) => (
        <li key={tile.bloodGroup}>
          <Link
            href={`/volunteer?group=${encodeURIComponent(tile.bloodGroup)}`}
            className={`app-tile app-tile-${tile.level}${
              selected === tile.bloodGroup ? ' app-tile-selected' : ''
            }`}
            aria-current={selected === tile.bloodGroup ? 'true' : undefined}
          >
            <span className="app-tile-group app-figure">{tile.bloodGroup}</span>

            <span className="app-tile-count app-figure">
              {tile.unitsOutstanding}
              <span className="app-tile-unit">
                {tile.unitsOutstanding === 1 ? ' unit' : ' units'}
              </span>
            </span>

            <span className="app-tile-state">{PRESSURE_LABELS[tile.level]}</span>

            {/*
              The recruitment effort, said quietly. "Nobody yet" beside twelve
              donors messaged means something different from "nobody yet" beside
              none, and a volunteer deciding where to spend an evening needs the
              difference.
            */}
            <span className="app-tile-note">
              {noteFor(tile)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function noteFor(tile: GroupPressure): string {
  if (tile.belowFloor && tile.unitsOutstanding === 0) return 'Shelf below floor';
  if (tile.unitsOutstanding === 0) return 'Nothing outstanding';

  const messaged = `${tile.donorsNotified} messaged`;
  if (tile.unitsConfirmed === 0) return messaged;
  return `${tile.unitsConfirmed} confirmed · ${messaged}`;
}

/** The key beside the tiles, so the colours are readable as a scale. */
export function PressureLegend({ levels }: { levels: readonly PressureLevel[] }) {
  return (
    <ul className="app-legend app-plain-list">
      {levels.map((level) => (
        <li className="app-legend-item" key={level}>
          <span className={`app-legend-swatch app-tile-${level}`} aria-hidden="true" />
          <span className="ux4g-label-s-default">{PRESSURE_LABELS[level]}</span>
        </li>
      ))}
    </ul>
  );
}
