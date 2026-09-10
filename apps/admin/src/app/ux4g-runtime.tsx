'use client';

import { useEffect } from 'react';

/**
 * Starts the UX4G runtime (Design.md §10).
 *
 * The runtime is event-delegated, no per-element binding, and supplies the
 * behaviours for Dropdown, Modal, Tooltip, Popover, Accordion, Tab, Carousel,
 * Drawer, Mega Menu and Alert. Everything else in the system is CSS-only, so a
 * page that uses none of those still renders correctly without it.
 *
 * Imported dynamically inside an effect because it is a browser side-effect
 * import with no server equivalent.
 */
export function Ux4gRuntime(): null {
  useEffect(() => {
    void import('ux4g-web-components/design-system');
  }, []);

  return null;
}
