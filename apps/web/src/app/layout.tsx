import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';

import 'ux4g-web-components/styles.css';
import './theme.css';
import './tailwind.css';
import '@blood-connect/ui/tokens/base.css';
import '@blood-connect/ui/tokens/accent-medical.css';
import '@blood-connect/ui/tokens/typography.css';

import { Ux4gRuntime } from './ux4g-runtime';
import { ServiceWorker } from './service-worker';

export const metadata: Metadata = {
  title: 'Blood Connect',
  description:
    'Blood requests, centre inventory and donor recruitment for a medical-college hospital.',

  manifest: '/manifest.webmanifest',
  applicationName: 'Blood Connect',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Blood Connect' },
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
  },
  // A ward device is shared: a private page must not be summarised in a search
  // result or a link preview.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The design system is light-only here by decision; declaring it stops the
  // browser painting a dark scrollbar and form controls around a light page.
  colorScheme: 'light',
  themeColor: '#ffffff',
  // Zooming stays available. Pinch-to-zoom is how a lot of people read a
  // screen, and disabling it fails WCAG 1.4.4.
  maximumScale: 5,
  userScalable: true,
  // Keeps content clear of a notch when installed to a home screen.
  viewportFit: 'cover',
};

/**
 * `data-theme` on `<html>` is required, not optional: UX4G components have no
 * fallback theme and render unstyled without it (Design.md §10). Stays for
 * every screen still on UX4G; the kit reads it too (light-only, ADR 0015).
 *
 * The Geist variables (`--font-geist-sans`, `--font-geist-mono`) are set on
 * the html element by `next/font` and read by the kit's typography tokens
 * (`--font-sans`, `--font-mono`) with a system fallback, so a page that
 * still uses UX4G's typography renders unchanged.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-theme="light"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body>
        <a className="app-skip-link" href="#main">
          Skip to main content
        </a>
        {children}
        <Ux4gRuntime />
        <ServiceWorker />
      </body>
    </html>
  );
}
