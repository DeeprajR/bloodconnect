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
      name: 'nothing-depends-on-the-control-panel',
      comment:
        'packages/ops reads across three modules so one screen can answer "is anything broken" ' +
        '(§11.9). Nothing may depend on it in return: an import would mean a rule had been ' +
        'written on the operations side of the boundary, where it would run only when somebody ' +
        'happened to open the panel.',
      severity: 'error',
      from: { path: '^packages/(?!ops)' },
      to: { path: '^packages/ops/' },
    },
    {
      name: 'the-control-panel-does-not-reach-the-bot',
      comment:
        'The panel is on `app_web`, which holds no grant on the `bot` schema (§5.1). What it ' +
        'knows about the bot arrives on `process_health`, published across the same boundary ' +
        'every other bot fact crosses.',
      severity: 'error',
      from: { path: '^packages/ops/' },
      to: { path: '^packages/bot/' },
    },
    {
      name: 'the-volunteer-board-sees-no-person',
      comment:
        'packages/volunteer reads the two shared tables of §7 and nothing else (§6). An import ' +
        'of hospital, centre or bot would give it a path to a patient, a doctor or a donor — ' +
        'the three things §6 says must never reach this surface. It may use platform for the ' +
        'context and domain for the rules, and that is the whole of its reach.',
      severity: 'error',
      from: { path: '^packages/volunteer/' },
      to: { path: '^packages/(hospital|centre|bot)/' },
    },
    {
      name: 'nothing-depends-on-the-volunteer-board',
      comment:
        'Module 4 is a read of shared state, so nothing should need it (§6). A module importing ' +
        'it would mean a rule had been written on the presentation side of the boundary.',
      severity: 'error',
      from: { path: '^packages/(?!volunteer)' },
      to: { path: '^packages/volunteer/' },
    },
    {
      name: 'the-bot-is-its-own-side',
      comment:
        'packages/bot integrates with the centre through two shared tables and no function call ' +
        '(§1). It may not import platform, hospital or centre — those are the web release, on a ' +
        'different database role, and an import would make the two deployables one.',
      severity: 'error',
      from: { path: '^packages/bot/' },
      to: { path: '^packages/(platform|hospital|centre)/' },
    },
    {
      name: 'the-web-release-does-not-import-the-bot',
      comment:
        'The other direction, for the same reason. What the centre knows about a donor arrives ' +
        'on a roster row in `hospital`, put there by the bot (§7).',
      severity: 'error',
      from: { path: '^packages/(platform|hospital|centre)/' },
      to: { path: '^packages/bot/' },
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
      name: 'module-boundary',
      comment:
        'One module may not reach inside another (§11.2). Each of platform / hospital / centre / ' +
        'volunteer exposes exactly one index.ts, and that is the whole of its surface — the ' +
        'alternative is the cross-module table read the spec forbids.',
      severity: 'error',
      from: { path: '^apps/web/src/modules/([^/]+)/' },
      to: {
        path: '^apps/web/src/modules/([^/]+)/(?!index\\.ts$)',
        pathNot: ['^apps/web/src/modules/$1/'],
      },
    },
    {
      name: 'no-http-in-a-module',
      comment:
        'A module may not import from app/. Routes and server actions call modules, never the ' +
        'reverse: the application layer must not know about HTTP, cookies or React (§3).',
      severity: 'error',
      from: { path: '^apps/[^/]+/src/modules/' },
      to: { path: '^apps/[^/]+/src/app/' },
    },
    {
      name: 'no-rule-in-a-route',
      comment:
        'No business logic in app/ (§9.1). A route or a server action parses input and calls one ' +
        'use case; it may not reach past a module entry point to do it itself.',
      severity: 'error',
      from: { path: '^apps/web/src/app/' },
      to: { path: '^apps/web/src/modules/[^/]+/(?!index\\.ts$)' },
    },
    {
      name: 'no-app-reaches-into-another',
      comment:
        'The staff application and the administration application are separate deployments ' +
        '(§1). Anything they share lives in packages/ — platform, in this case — so that the ' +
        'shared surface is an entry point rather than whatever one app happens to expose.',
      severity: 'error',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/([^/]+)/', pathNot: ['^apps/$1/'] },
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
          // Next's file conventions: a page, a layout, the proxy and the config
          // are entry points the framework calls, not modules anything imports.
          '^apps/[^/]+/next\\.config\\.ts$',
          '^apps/[^/]+/src/(proxy|middleware|instrumentation)\\.ts$',
          '^apps/[^/]+/src/app/.+\\.(ts|tsx)$',
          // A test is run, not imported.
          '\\.(test|spec)\\.ts$',
        ],
      },
      to: {},
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|coverage|\\.next|node_modules)/' },
    tsPreCompilationDeps: true,
    // No tsConfig here: each application is cruised with its own, passed on the
    // command line, because both map `@/*` to their own src. One shared mapping
    // would resolve the admin app's imports into the staff app and report
    // violations that are not there.
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'types', 'default'],
      extensions: ['.js', '.ts', '.tsx'],
      mainFields: ['module', 'main', 'types'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
