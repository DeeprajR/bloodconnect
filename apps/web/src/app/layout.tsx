import type { Metadata, Viewport } from 'next';

import 'ux4g-web-components/styles.css';
import './theme.css';

import { Ux4gRuntime } from './ux4g-runtime';

export const metadata: Metadata = {
  title: 'Blood Connect',
  description:
    'Blood requests, centre inventory and donor recruitment for a medical-college hospital.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The design system is light-only here by decision; declaring it stops the
  // browser painting a dark scrollbar and form controls around a light page.
  colorScheme: 'light',
};

/**
 * `data-theme` on `<html>` is required, not optional: UX4G components have no
 * fallback theme and render unstyled without it (Design.md §10).
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="light">
      <body>
        <a className="app-skip-link" href="#main">
          Skip to main content
        </a>
        {children}
        <Ux4gRuntime />
      </body>
    </html>
  );
}
