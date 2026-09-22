import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';

// `tailwind.css` `@import`s the kit token files (base, accent-admin,
// typography, preflight) so their `@theme` blocks and preflight's global
// resets pass through Tailwind's PostCSS pipeline. Importing them here as
// separate `.tsx` CSS side-effect imports would bypass that pipeline —
// Turbopack treats each one as a standalone CSS module — and Tailwind
// would emit neither the custom properties nor the `bg-canvas` /
// `text-ink` / `bg-primary` utilities.
import './tailwind.css';

import { ServiceWorker } from './service-worker';

export const metadata: Metadata = {
  title: 'Blood Connect administration',
  description: 'Doctor records and their patient activity.',

  manifest: '/manifest.webmanifest',
  applicationName: 'Blood Connect administration',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Blood Connect administration' },
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
 * `data-theme="light"` on `<html>` is a kit convention, not a UX4G one
 * (ADR 0015's "Supersedes"): the design system is light-only for the same
 * shared-workstation reason UX4G was, and any future component reads the
 * attribute for that purpose.
 *
 * The Geist variables (`--font-geist-sans`, `--font-geist-mono`) are set on
 * the html element by `next/font` and read by the kit's typography tokens
 * (`--font-sans`, `--font-mono`) with a system fallback.
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
        {/*
         * A visually-hidden link that appears on focus, letting a keyboard
         * user skip the shell's nav and jump straight to `#main`. No kit
         * component for this — it is one link, not a design-system concern.
         */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:border focus:border-border-strong focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-ink"
        >
          Skip to main content
        </a>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
