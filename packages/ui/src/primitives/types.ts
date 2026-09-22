/**
 * The tone a badge or state hint uses to reach a viewer.
 *
 * A badge that uses one of these values must also render a label and a
 * shaped dot: colour is never the only signal (WCAG 1.4.1, §22).
 *
 * Applications map their own enums onto these tones in their own
 * `badges.tsx` (or equivalent) — the kit's `StatusBadge` reads a
 * `Tone` value and renders it, and never knows about REQUEST_STATUSES
 * or any other domain enum, so a shape change on the domain side does
 * not force a rebuild of the design kit.
 */
export type Tone =
  | 'neutral'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'primary';

export const TONES: readonly Tone[] = [
  'neutral',
  'info',
  'success',
  'warning',
  'danger',
  'primary',
] as const;
