/**
 * PostCSS configuration for the staff application.
 *
 * `.cjs` and not `.mjs` on purpose: apps/web has `"type": "module"`, so
 * a bare `.js` PostCSS config would be treated as ESM and fail to load
 * with a `require` shape. `.cjs` forces CommonJS, which is what the
 * Tailwind PostCSS plugin's loader expects.
 *
 * The only plugin here is `@tailwindcss/postcss`, which is what Tailwind
 * v4 uses to process `@import "tailwindcss";` and `@theme { ... }`
 * blocks into CSS custom properties and utility classes at build time.
 *
 * Added in PR-02b of the UX4G-replacement track (ADR 0015). UX4G's own
 * `theme.css` does not go through Tailwind processing; only the app's
 * `tailwind.css` entry and any file it `@import`s do.
 */
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
