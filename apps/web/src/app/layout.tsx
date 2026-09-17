import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';

// UX4G's stylesheet and the leftover theme overrides are unlayered legacy
// CSS; `legacy-styles.css` re-imports both inside an explicit `layer(legacy)`
// so Tailwind's utilities (which are all in named layers) win over them
// instead of silently losing to them — see the comment in that file for why
// this matters. It must load before `tailwind.css` so the `legacy` layer
// registers first and ranks lowest.
import './legacy-styles.css';
// `tailwind.css` `@import`s the kit token files (base, accent-medical,
// typography) so their `@theme` blocks pass through Tailwind's PostCSS
// pipeline. Importing them here as separate `.tsx` CSS side-effect
// imports would bypass that pipeline — Turbopack treats each one as a
// standalone CSS module — and Tailwind would emit neither the custom
// properties nor the `bg-canvas` / `text-ink` / `bg-primary` utilities.
import './tailwind.css';

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
      {/*
       * `bg-canvas text-ink` on the body is what pins the page to the kit's
       * clinical light palette. Without it the browser paints the body with
       * its own default canvas, and a browser set to prefer dark shows the
       * kit's dark ink on that dark canvas. `color-scheme: light` in the
       * viewport handles native form controls; this handles the surface
       * they sit on. Kept until the last UX4G screen is gone and the kit's
       * `preflight.css` (which sets the same three things globally) can be
       * imported without conflict.
       */}
      <body className="bg-canvas text-ink">
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
