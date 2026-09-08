import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // The workspace packages are TypeScript source; Next compiles them itself
  // rather than requiring a build step between edit and reload.
  transpilePackages: [
    '@blood-connect/config',
    '@blood-connect/contract',
    '@blood-connect/db',
    '@blood-connect/domain',
    '@blood-connect/ids',
    '@blood-connect/result',
  ],
  serverExternalPackages: ['postgres', '@node-rs/argon2'],
  poweredByHeader: false,
  typedRoutes: true,
};

export default config;
