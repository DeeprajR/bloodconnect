import type { Metadata, Viewport } from 'next';

import 'ux4g-web-components/styles.css';
import './theme.css';

import { Ux4gRuntime } from './ux4g-runtime';
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
        <ServiceWorker />
      </body>
    </html>
  );
}
