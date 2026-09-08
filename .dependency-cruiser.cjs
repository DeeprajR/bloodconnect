/**
 * The import boundary, enforced (§2, §11.2).
 *
 * §11.2 forbids one module reading another's tables and forbids deep imports
 * past a package's published entry point. Neither survives as a convention:
 * the first deep import is always reasonable in isolation, and by the tenth the
 * boundary is gone. So it is a build failure, and `pnpm boundaries:prove` writes
 * a violating file and asserts that this configuration actually rejects it.
 *
 * Rules here cover `packages/*` and `db`. `apps/*` rules are added with the apps
 * themselves, in P1 and P4, in the same shape.
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-is-pure',
      comment:
        'packages/domain may not import anything outside itself (§2). It holds the clinical ' +
        'rules shared by the web app and the bot, and a dependency on a driver, a framework ' +
        'or a clock is what turns a pure rule into an untestable one.',
      severity: 'error',
      from: { path: '^packages/domain/' },
      to: {
        pathNot: ['^packages/domain/', 'node_modules/typescript/'],
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'no-deep-package-imports',
      comment:
        'Import another package by its name, not by a path into its src (§11.2). The entry ' +
        'point is the contract; a deep import couples a caller to a file layout that is free ' +
        'to change. A package reaching into its own src is exactly how it is meant to be built.',
      severity: 'error',
      from: { path: '^packages/([^/]+)/' },
      to: { path: '^packages/([^/]+)/src/', pathNot: ['^packages/$1/'] },
    },
    {
      name: 'no-deep-package-imports-from-apps',
      comment:
        'The same rule for everything outside packages/: apps and db import a package by name ' +
        '(§11.2).',
      severity: 'error',
      from: { pathNot: '^packages/' },
      to: { path: '^packages/[^/]+/src/.+' },
    },
    {
      name: 'contract-is-shared-only',
      comment:
        'packages/contract is the versioned package both applications depend on (§6). It may ' +
        'use the domain and Zod, and nothing else — a dependency on either side would make it ' +
        'that side’s package rather than the boundary between them.',
      severity: 'error',
      from: { path: '^packages/contract/' },
      to: { path: '^(packages/(?!contract|domain)|apps/|db/)' },
    },
    {
      name: 'no-production-code-in-testing',
      comment:
        'packages/testing holds fakes and harnesses. Nothing outside a test may import it, so ' +
        'a fake clock can never reach a running system (§3).',
      severity: 'error',
      from: { pathNot: ['\\.(test|spec)\\.ts$', '^packages/testing/'] },
      to: { path: '^packages/testing/' },
    },
    {
      name: 'db-is-not-a-domain',
      comment:
        'The db package holds the schema and the migration runner. A clinical rule that appears ' +
        'here will diverge from the one in packages/domain (§3).',
      severity: 'error',
      from: { path: '^db/src/schema/' },
      to: { path: '^packages/(?!domain|ids)' },
    },
    {
      name: 'no-circular',
      comment: 'A cycle means the layering has been crossed somewhere (§3).',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      comment: 'A module nothing imports is either dead or wired up wrong.',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$',
          '\\.d\\.ts$',
          '(^|/)tsconfig\\.json$',
          '(^|/)(drizzle|eslint|vitest)\\.config\\.(js|cjs|mjs|ts)$',
          '^db/src/(migrate|seed|push-guard)\\.ts$',
          // A package entry point is an orphan until something imports it, and
          // publishing it before its first caller exists is the intended order.
          '^packages/[^/]+/src/index\\.ts$',
        ],
      },
      to: {},
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|coverage)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'types', 'default'],
      extensions: ['.js', '.ts'],
      mainFields: ['module', 'main', 'types'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
