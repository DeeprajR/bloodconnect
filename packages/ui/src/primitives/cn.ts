/**
 * Minimal className joiner (no dependency).
 *
 * Ported verbatim from the blood-connect-ui hackathon frontend
 * (ADR 0015). Kept as a zero-dependency utility rather than pulling in
 * `clsx` or `classnames`: the whole kit is presentation and any
 * dependency here reaches into every consuming app.
 */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
