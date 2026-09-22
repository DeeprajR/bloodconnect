import {
  STOCK_BANDS,
  STOCK_BAND_LABELS,
  bloodGroupLabel,
  stockBandFor,
  stockFillFraction,
  type BloodGroup,
  type StockBand,
} from '@blood-connect/domain';

/**
 * Stock against the floor, one bar per group (§4).
 *
 * A server component with no state and no client bundle: it is a picture
 * of numbers the page already fetched.
 *
 * **Colour is never the only signal** (WCAG 1.4.1, Design.md §9). Three
 * things carry the same information independently, the height of each
 * fill, the count printed on it, and `aria-valuetext` naming the band in
 * words, so the chart survives a screen reader, a monochrome print and
 * the eight percent of men who would read the orange and the green as
 * the same colour.
 *
 * Ported off UX4G in PR-09 (ADR 0015). The five bands use kit tokens
 * (success, warning, danger, danger/60, neutral); the two danger tones
 * are distinguishable because "short" sits below the count printed on
 * the bar itself and "critical" is what the count itself is.
 */

const BAND_FILL: Readonly<Record<StockBand, string>> = {
  adequate: 'bg-success text-white',
  low: 'bg-warning text-white',
  short: 'bg-danger/60 text-white',
  critical: 'bg-danger text-white',
  empty: 'bg-neutral text-white',
};

const BAND_SWATCH: Readonly<Record<StockBand, string>> = {
  adequate: 'bg-success',
  low: 'bg-warning',
  short: 'bg-danger/60',
  critical: 'bg-danger',
  empty: 'bg-neutral',
};

/**
 * Below this share of the track, the count is printed above the bar
 * instead of inside it.
 */
const LABEL_FITS_ABOVE = 0.2;

export type StockChartRow = {
  readonly bloodGroup: BloodGroup;
  readonly onShelf: number;
  readonly floor: number;
};

export function StockChart({
  rows,
  fractions,
}: {
  readonly rows: readonly StockChartRow[];
  /** `stock.low_fraction` and `stock.critical_fraction`, read by the page (§12). */
  readonly fractions: { readonly low: number; readonly critical: number };
}) {
  return (
    <>
      {/*
        The bars scroll sideways on a phone rather than shrinking, the
        same way the tables do. Eight bars squeezed into 360px would each
        be a sliver.
      */}
      <div className="overflow-x-auto">
        <div className="flex min-w-max gap-3 pb-2 pt-6">
          {rows.map((row) => {
            const band = stockBandFor(row.onShelf, row.floor, fractions);
            const fill = stockFillFraction(row.onShelf, row.floor);
            const group = bloodGroupLabel(row.bloodGroup);

            /**
             * The meter's range has to contain its own value.
             *
             * A group above the floor is the ordinary case, 33 against a
             * floor of 25, and reporting `aria-valuenow="33"` inside a
             * range that stops at 25 is invalid ARIA that a screen
             * reader is free to clamp or to read as nonsense. The bar is
             * capped at full; the range is not, and the surplus stays
             * audible.
             */
            const range = Math.max(row.floor, row.onShelf, 1);
            // "4 of 0 units" is what a centre with no floor set would hear.
            const reading =
              row.floor > 0
                ? `${String(row.onShelf)} of ${String(row.floor)} units`
                : `${String(row.onShelf)} units, no floor set`;
            const count =
              row.floor > 0
                ? `${String(row.onShelf)}/${String(row.floor)}`
                : String(row.onShelf);

            return (
              <div
                className="flex w-14 flex-col items-center gap-2"
                key={row.bloodGroup}
              >
                <div
                  className="relative flex h-60 w-full flex-col-reverse rounded-control border border-border bg-surface-muted"
                  /*
                    A meter, not a progressbar: this is a measurement
                    within a known range, not a task advancing towards
                    completion.
                  */
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={range}
                  aria-valuenow={row.onShelf}
                  // The band in words. Without it a screen reader reads
                  // "6 of 25" and the colour, the whole point, is simply
                  // lost.
                  aria-valuetext={`${reading}. ${STOCK_BAND_LABELS[band]}`}
                  aria-label={`${group} stock against the floor`}
                >
                  {/*
                    A short bar cannot hold its own label, so the label
                    steps outside rather than the bar growing to fit it.
                  */}
                  {fill < LABEL_FITS_ABOVE ? (
                    <p className="absolute inset-x-0 -top-6 text-center text-xs font-semibold tabular-nums text-ink">
                      {count}
                    </p>
                  ) : null}
                  <div
                    className={`flex items-start justify-center rounded-control pt-1 text-xs font-semibold tabular-nums ${BAND_FILL[band]}`}
                    // The one inline style here, because the value is
                    // data: it is a different number for every group on
                    // every render.
                    style={{ blockSize: `${String(Math.round(fill * 100))}%` }}
                  >
                    {fill < LABEL_FITS_ABOVE ? null : count}
                  </div>
                </div>
                <p className="text-sm font-semibold tabular-nums text-ink">
                  {group}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/*
        The legend earns its space: four colours whose order is not
        obvious until somebody has been told, and "none" is not simply
        "worse than critical". It is the state where a request cannot be
        answered at all.
      */}
      <ul
        className="flex list-none flex-wrap gap-3 p-0 text-xs text-ink-muted"
        aria-label="What the colours mean"
      >
        {STOCK_BANDS.map((band) => (
          <li className="flex items-center gap-1.5" key={band}>
            <span
              className={`inline-block size-2.5 rounded-sm ${BAND_SWATCH[band]}`}
              aria-hidden="true"
            />
            {STOCK_BAND_LABELS[band]}
          </li>
        ))}
      </ul>
    </>
  );
}
