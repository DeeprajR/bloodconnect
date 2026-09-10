'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker (§2.8).
 *
 * Only in production. In development the worker would serve a stale shell
 * across rebuilds, which turns every hot reload into a puzzle, and the offline
 * behaviour is not what is being worked on there.
 */
export function ServiceWorker(): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    const register = (): void => {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' });
    };

    // After load, so registering never competes with the first render for
    // bandwidth on the connection this exists to cope with.
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
