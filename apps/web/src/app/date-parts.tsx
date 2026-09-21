'use client';

import { useMemo, useState } from 'react';

/**
 * A date as three fields: year, month, day.
 *
 * The native date input is the wrong instrument for a date of birth. It opens on
 * this month and asks somebody to walk back four hundred taps to 1961, and on a
 * desktop it is a text box with a locale-dependent order that nobody at a
 * counter can guess. Three lists have none of that: a year is chosen in one
 * scroll, a month is a word rather than a number nobody agrees the order of, and
 * the day list is as long as the month actually is.
 *
 * It is the same shape the donor interview already asks in, year, month, day, so
 * a counter typing for a bystander and a donor answering the bot are giving
 * their date of birth in the same order (§5).
 *
 * The value posted is one hidden field in `YYYY-MM-DD`, so the server action and
 * the use case behind it see exactly what a date input would have sent. A
 * partly-filled date posts nothing: two thirds of a birthday is not a birthday,
 * and writing `2000-03-` into a clinical record is worse than leaving it empty.
 */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Leap years included, which is why this is computed rather than a table. */
const daysInMonth = (year: number, month: number): number =>
  year > 0 && month > 0 ? new Date(year, month, 0).getDate() : 31;

const pad = (value: number): string => String(value).padStart(2, '0');

export function DateParts({
  id,
  label,
  hint,
  /** The oldest year offered. A hundred and twenty covers every living patient. */
  yearsBack = 120,
  defaultValue = '',
  required = false,
}: {
  id: string;
  label: string;
  hint?: string;
  yearsBack?: number;
  /** `YYYY-MM-DD`, as the server would send it back after a failed submit. */
  defaultValue?: string;
  required?: boolean;
}) {
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(defaultValue);

  const [year, setYear] = useState(parsed?.[1] ?? '');
  const [month, setMonth] = useState(parsed?.[2] ?? '');
  const [day, setDay] = useState(parsed?.[3] ?? '');

  const thisYear = new Date().getFullYear();
  const years = useMemo(
    () => Array.from({ length: yearsBack + 1 }, (_, i) => thisYear - i),
    [thisYear, yearsBack],
  );

  /**
   * The day list follows the month, so 31 February is never offered.
   *
   * A day already chosen that the new month does not have is dropped rather than
   * quietly clamped: somebody who picked the 31st and then corrected the month
   * should be asked again, not given the 30th without being told.
   */
  const length = daysInMonth(Number(year), Number(month));
  const days = useMemo(() => Array.from({ length }, (_, i) => i + 1), [length]);
  const dayValue = Number(day) > length ? '' : day;

  const complete = year !== '' && month !== '' && dayValue !== '';
  const value = complete ? `${year}-${month}-${pad(Number(dayValue))}` : '';

  const SELECT =
    'h-10 w-full rounded-control border border-border-strong bg-surface px-3 pr-8 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';

  return (
    <fieldset className="space-y-1.5">
      <legend className="block text-sm font-medium text-ink">{label}</legend>

      {/* One field to the server, whatever the three lists are doing. */}
      <input type="hidden" name={id} value={value} />

      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <label className="block text-xs text-ink-subtle" htmlFor={`${id}-year`}>
            Year
          </label>
          <select
            className={SELECT}
            id={`${id}-year`}
            value={year}
            required={required}
            onChange={(event) => {
              setYear(event.target.value);
            }}
            aria-describedby={hint ? `${id}-hint` : undefined}
          >
            <option value="">YYYY</option>
            {years.map((option) => (
              <option key={option} value={String(option)}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="block text-xs text-ink-subtle" htmlFor={`${id}-month`}>
            Month
          </label>
          <select
            className={SELECT}
            id={`${id}-month`}
            value={month}
            required={required}
            onChange={(event) => {
              setMonth(event.target.value);
            }}
          >
            <option value="">MM</option>
            {MONTHS.map((name, index) => (
              <option key={name} value={pad(index + 1)}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="block text-xs text-ink-subtle" htmlFor={`${id}-day`}>
            Day
          </label>
          <select
            className={SELECT}
            id={`${id}-day`}
            value={dayValue}
            required={required}
            onChange={(event) => {
              setDay(event.target.value);
            }}
          >
            <option value="">DD</option>
            {days.map((option) => (
              <option key={option} value={pad(option)}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </div>

      {hint ? (
        <p className="text-xs text-ink-subtle" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </fieldset>
  );
}
