/**
 * The shape of a silent failure (§11.9).
 *
 * §11.9 names what to alert on and gives it no surface. This is the type that
 * surface is built from, and it lives in `domain` because four separate places
 * produce one: the platform for its email outbox, the centre for its shelf, the
 * bot for its own half published across the boundary, and the panel itself for
 * a process that has stopped reporting.
 *
 * **Counts and ages, never a person.** Every field here is a number, an
 * identifier or a fixed string. §11.9 forbids a name, a phone number or a
 * health datum in anything that reaches a log or an operations screen, and the
 * cheapest way to keep that true is a type with nowhere to put one. `sample`
 * carries record ids so a row can link to the thing it is about, which is what
 * makes the board a way in rather than a dead end.
 */

/**
 * How loudly a row asks to be looked at.
 *
 * Three levels, because an operator woken at 3am is triaging rather than
 * reading: `critical` means somebody is waiting on it right now, `warning`
 * means it will become that if nobody looks today, and `info` is context that
 * makes the other two legible.
 */
export const ALERT_LEVELS = ['critical', 'warning', 'info'] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];

export type Alert = {
  /** Stable, dotted, and the same string on both sides of the boundary. */
  readonly kind: string;
  readonly level: AlertLevel;
  /** What is wrong, in a sentence an operator can act on. */
  readonly title: string;
  /**
   * What to do about it.
   *
   * Required rather than optional. §11.9's point about a red tile applies to a
   * board row just as much: one that does not say what to do is a line that
   * wakes somebody up for nothing.
   */
  readonly whatToDo: string;
  readonly count: number;
  /** Age of the oldest affected row, in seconds. Null when nothing is waiting. */
  readonly oldestAgeSeconds: number | null;
  /**
   * Up to a handful of record ids, so the row links somewhere.
   *
   * Ids only. A request id or a demand id names a record; a patient name names
   * a person, and this type has no field that could hold one.
   */
  readonly sample: readonly string[];
  /** Where the row leads, as a path within `app`. */
  readonly href?: string;
  /**
   * Which application that path belongs to.
   *
   * The panel is administrator-only and lives in the administration
   * application, but most of what it reports about happens in the staff one:
   * the quarantine screen, the tag register, the demand list. Those are
   * separate deployments on separate origins (§1), so a row cannot simply
   * carry a path. The producing module says which application; the panel puts
   * the origin on the front.
   */
  readonly app?: 'staff' | 'admin';
};

/** Nothing wrong is a state, not an absence: the board says so rather than being empty. */
export const isQuiet = (alerts: readonly Alert[]): boolean =>
  alerts.every((alert) => alert.count === 0);

export const worstLevel = (alerts: readonly Alert[]): AlertLevel | null => {
  const live = alerts.filter((alert) => alert.count > 0);
  if (live.length === 0) return null;
  if (live.some((alert) => alert.level === 'critical')) return 'critical';
  if (live.some((alert) => alert.level === 'warning')) return 'warning';
  return 'info';
};

/** Ordered for a person reading top to bottom: loudest first, then oldest. */
export function rankAlerts(alerts: readonly Alert[]): readonly Alert[] {
  const weight: Record<AlertLevel, number> = { critical: 0, warning: 1, info: 2 };
  return [...alerts]
    .filter((alert) => alert.count > 0)
    .sort(
      (a, b) =>
        weight[a.level] - weight[b.level] ||
        (b.oldestAgeSeconds ?? 0) - (a.oldestAgeSeconds ?? 0) ||
        b.count - a.count,
    );
}
