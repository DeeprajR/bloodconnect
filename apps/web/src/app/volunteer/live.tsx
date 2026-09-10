'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Live, without a refresh button (§6).
 *
 * The numbers move on the scale of minutes, so a poll is the right mechanism
 * and a socket would be machinery for nothing. `router.refresh()` re-runs the
 * server component and replaces the data without unmounting anything, so a
 * volunteer reading a demand list does not lose their place mid-poll.
 *
 * It stops while the tab is hidden. A dashboard left open on a phone in a
 * pocket should not spend the evening waking the radio for numbers nobody is
 * reading.
 */
export function LiveRefresh({ everySeconds = 60 }: { everySeconds?: number }) {
  const router = useRouter();

  useEffect(() => {
    const tick = (): void => {
      if (document.visibilityState === 'visible') router.refresh();
    };

    const timer = setInterval(tick, everySeconds * 1000);
    // Coming back to the tab is the moment the numbers are most likely stale.
    document.addEventListener('visibilitychange', tick);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [router, everySeconds]);

  return null;
}
