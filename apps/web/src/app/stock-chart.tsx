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
 * A server component with no state and no client bundle: it is a picture of
 * numbers the page already fetched.
 *
 * **Colour is never the only signal** (WCAG 1.4.1, Design.md §9). Three things
 * carry the same information independently — the height of each fill, the count
 * printed on it, and `aria-valuetext` naming the band in words — so the chart
 * survives a screen reader, a monochrome print and the eight percent of men who
 * would read the orange and the green as the same colour.
 */

const BAND_CLASSES: Readonly<Record<StockBand, string>> = {
  adequate: 'app-chart-adequate',
  low: 'app-chart-low',
  short: 'app-chart-short',
  critical: 'app-chart-critical',
  empty: 'app-chart-empty',
};

/**
 * Below this share of the track, the count is printed above the bar instead of
 * inside it.
 *
 * A 240px track makes this about 48px — comfortably more than the line box the
 * figure needs. Forcing every fill to be at least that tall instead is what
 * made 1/25, 3/25 and 6/25 render as three identical bars.
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
        The bars scroll sideways on a phone rather than shrinking, the same way
        the tables do. Eight bars squeezed into 360px would each be a sliver.
      */}
      <div className="app-scroll-x">
        <div className="app-chart">
          {rows.map((row) => {
            const band = stockBandFor(row.onShelf, row.floor, fractions);
            const fill = stockFillFraction(row.onShelf, row.floor);
            const group = bloodGroupLabel(row.bloodGroup);

            /**
             * The meter's range has to contain its own value.
             *
             * A group above the floor is the ordinary case — 33 against a floor
             * of 25 — and reporting `aria-valuenow="33"` inside a range that
             * stops at 25 is invalid ARIA that a screen reader is free to clamp
             * or to read as nonsense. The bar is capped at full; the range is
             * not, and the surplus stays audible.
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
              <div className="app-chart-column" key={row.bloodGroup}>
                <div
                  className="app-chart-track"
                  /*
                    A meter, not a progressbar: this is a measurement within a
                    known range, not a task advancing towards completion.
                  */
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={range}
                  aria-valuenow={row.onShelf}
                  // The band in words. Without it a screen reader reads "6 of
                  // 25" and the colour — the whole point — is simply lost.
                  aria-valuetext={`${reading}. ${STOCK_BAND_LABELS[band]}`}
                  aria-label={`${group} stock against the floor`}
                >
                  {/*
                    A short bar cannot hold its own label, so the label steps
                    outside rather than the bar growing to fit it.
                  */}
                  {fill < LABEL_FITS_ABOVE ? (
                    <p className="app-chart-count ux4g-label-m-strong app-figure">{count}</p>
                  ) : null}
                  <div
                    className={`app-chart-fill ${BAND_CLASSES[band]} app-figure`}
                    // The one inline style here, because the value is data: it
                    // is a different number for every group on every render.
                    style={{ blockSize: `${String(Math.round(fill * 100))}%` }}
                  >
                    {fill < LABEL_FITS_ABOVE ? null : count}
                  </div>
                </div>
                <p className="app-chart-group ux4g-label-m-strong app-figure">{group}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/*
        The legend earns its space: four colours whose order is not obvious
        until somebody has been told, and "none" is not simply "worse than
        critical" — it is the state where a request cannot be answered at all.
      */}
      <ul className="app-legend ux4g-label-m-default" aria-label="What the colours mean">
        {STOCK_BANDS.map((band) => (
          <li className="app-legend-item" key={band}>
            <span className={`app-legend-swatch ${BAND_CLASSES[band]}`} aria-hidden="true" />
            {STOCK_BAND_LABELS[band]}
          </li>
        ))}
      </ul>
    </>
  );
}
