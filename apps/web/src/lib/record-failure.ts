import { APP_TIMEZONE, dayOf } from '@blood-connect/domain';
import { db } from '@blood-connect/platform';
import { recordSample, type Surface } from '@blood-connect/ops';

/**
 * A render that threw, recorded as a 500 (§11.9).
 *
 * **No message, no stack, no digest.** §11.9 keeps identifying data out of
 * anything operational, and a thrown error's message is the least predictable
 * string in the system: it can carry a query, a bound parameter, or a patient's
 * name that happened to be in scope. The panel needs to know which route is
 * failing and how often. What it failed with belongs in the process log on the
 * host, where §12's retention applies.
 */
export async function recordFailedRender(
  surface: Surface,
  request: { path?: string; method?: string },
): Promise<void> {
  await recordSample(
    {
      db,
      clock: {
        now: () => new Date(),
        today: (timeZone: string = APP_TIMEZONE) => dayOf(new Date(), timeZone),
      },
    },
    {
      surface,
      route: routeOf(request.path),
      method: request.method ?? 'GET',
      status: 500,
      durationMs: 0,
    },
  );
}

/**
 * A path reduced to something safe to store.
 *
 * Any segment shaped like an identifier becomes a placeholder, so a uuid or a
 * request number cannot reach the table through this hook. Aggregation wants
 * the pattern rather than the path anyway.
 */
function routeOf(path: string | undefined): string {
  if (!path) return 'unknown';
  return path
    .split('/')
    .map((segment) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment) || /^\d{6}-\d{5}$/.test(segment)
        ? '[id]'
        : segment,
    )
    .join('/');
}
