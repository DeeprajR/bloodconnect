import { type ReactNode } from 'react';
import { cn } from '../primitives/cn.js';

export interface Column<Row> {
  key: string;
  header: string;
  /** Cell renderer. */
  cell: (row: Row) => ReactNode;
  /** Shown as the label in the stacked mobile card view. Defaults to `header`. */
  mobileLabel?: string;
  align?: 'left' | 'right';
  /** Hide this column in the mobile card view. */
  hideOnMobile?: boolean;
}

/**
 * Responsive table: a real `<table>` on md+ screens, and a stacked
 * label/value card list on small screens so wide tables stay usable
 * (no raw overflow).
 */
export function DataTable<Row>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  caption,
  emptyLabel = 'No records.',
}: {
  columns: Column<Row>[];
  rows: Row[];
  getRowKey: (row: Row) => string;
  onRowClick?: (row: Row) => void;
  caption?: string;
  emptyLabel?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-card border border-border bg-surface p-8 text-center text-sm text-ink-muted">
        {emptyLabel}
      </div>
    );
  }

  return (
    <>
      {/* Desktop */}
      <div className="hidden overflow-x-auto rounded-card border border-border bg-surface md:block">
        <table className="w-full border-collapse text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr className="border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-ink-subtle">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    'px-4 py-2.5 font-semibold',
                    c.align === 'right' && 'text-right',
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={getRowKey(row)}
                onClick={onRowClick ? () => { onRowClick(row); } : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === 'Enter') onRowClick(row);
                      }
                    : undefined
                }
                className={cn(
                  'border-b border-border last:border-0',
                  onRowClick &&
                    'cursor-pointer hover:bg-surface-muted focus-visible:bg-surface-muted',
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      'px-4 py-3 align-middle text-ink',
                      c.align === 'right' && 'text-right tabular-nums',
                    )}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li
            key={getRowKey(row)}
            onClick={onRowClick ? () => { onRowClick(row); } : undefined}
            className={cn(
              'rounded-card border border-border bg-surface p-4',
              onRowClick && 'cursor-pointer active:bg-surface-muted',
            )}
          >
            <dl className="grid grid-cols-[minmax(0,7rem)_1fr] gap-x-3 gap-y-1.5 text-sm">
              {columns
                .filter((c) => !c.hideOnMobile)
                .map((c) => (
                  <div key={c.key} className="contents">
                    <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                      {c.mobileLabel ?? c.header}
                    </dt>
                    <dd className="text-ink">{c.cell(row)}</dd>
                  </div>
                ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
