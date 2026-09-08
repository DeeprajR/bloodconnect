import type { Metadata, Viewport } from 'next';

import 'ux4g-web-components/styles.css';
import './theme.css';

import { Ux4gRuntime } from './ux4g-runtime';

export const metadata: Metadata = {
  title: 'Blood Connect administration',
  description: 'Doctor records and their patient activity.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light',
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
      </body>
    </html>
  );
}
