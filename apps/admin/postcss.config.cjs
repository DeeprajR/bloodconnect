/**
 * PostCSS configuration for the administration application.
 *
 * `.cjs` and not `.mjs` on purpose: apps/admin has `"type": "module"`, so
 * a bare `.js` PostCSS config would be treated as ESM and fail to load
 * with a `require` shape. `.cjs` forces CommonJS, which is what the
 * Tailwind PostCSS plugin's loader expects.
 *
 * The only plugin here is `@tailwindcss/postcss`, which is what Tailwind
 * v4 uses to process `@import "tailwindcss";` and `@theme { ... }`
 * blocks into CSS custom properties and utility classes at build time.
 *
 * Mirrors apps/web's postcss.config.cjs (PR-02b of ADR 0015).
 */
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
