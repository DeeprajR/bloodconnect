import { after } from 'next/server';

import { APP_TIMEZONE, dayOf } from '@blood-connect/domain';
import { db } from '@blood-connect/platform';
import { recordSample, type MetricsContext, type Surface } from '@blood-connect/ops';

/**
 * Recording what the application served (§11.9).
 *
 * **Next's proxy cannot see the downstream status.** It runs before the render
 * and returns `NextResponse.next()`; what the page eventually answered with is
 * not observable from there. So metrics are taken where the status is actually
 * known, in three places rather than one:
 *
 *  - a completed page render calls `notePage`, which records a 200, because a
 *    render that reaches the end of the page is a render that succeeded;
 *  - a render that throws is recorded as a 500 by `onRequestError` in
 *    `instrumentation.ts`, which is the framework's own hook for exactly that;
 *  - the proxy records the refusals it issues itself, which are the only
 *    statuses it does know.
 *
 * The alternative was a middleware that timed its own work and called it the
 * request's latency, which would have produced a number that looks like a
 * measurement and is not one.
 */

/**
 * A connection and a clock, which is all a metrics write needs.
 *
 * Deliberately not the use-case context: there is no actor here, nothing to
 * authorize and nothing to hash, and taking the full context would pull the
 * password hasher into a code path that runs after every response.
 */
const metricsContext = (): MetricsContext => ({
  db,
  clock: {
    now: () => new Date(),
    today: (timeZone: string = APP_TIMEZONE) => dayOf(new Date(), timeZone),
  },
});

/** Written after the response is on its way, never in front of it. */
export function notePage(route: string, startedAt: number, surface: Surface = 'admin'): void {
  after(async () => {
    await recordSample(metricsContext(), {
      surface,
      route,
      method: 'GET',
      status: 200,
      durationMs: Date.now() - startedAt,
    });
  });
}

/**
 * Wraps a route handler, so its real status and duration are recorded.
 *
 * A route handler is the one place the whole request is visible in one
 * function, which is why the API surfaces are measured properly and the page
 * surfaces are measured by completion.
 */
export function measured<T extends Response>(
  surface: Surface,
  route: string,
  method: string,
  handler: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();

  return handler().then(
    (response) => {
      record(surface, route, method, response.status, startedAt);
      return response;
    },
    (cause: unknown) => {
      record(surface, route, method, 500, startedAt);
      throw cause;
    },
  );
}

export function record(
  surface: Surface,
  route: string,
  method: string,
  status: number,
  startedAt: number,
): void {
  after(async () => {
    await recordSample(metricsContext(), {
      surface,
      route,
      method,
      status,
      durationMs: Date.now() - startedAt,
    });
  });
}
