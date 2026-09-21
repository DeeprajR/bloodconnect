# 0015 · UX4G replaced by an in-repo clinical kit

**Status.** Accepted. In progress — see "Progress" below for the current
state of the rollout, two bugs the rollout surfaced, and what's next.

## Context

The staff (`apps/web`) and administration (`apps/admin`) applications
were built on UX4G (`ux4g-web-components`, gov.in design system). It
shipped a large CSS bundle, forced `data-theme="light"` on `<html>` to
render at all ([ADR 0004](0004-pwa-and-a-spacing-token-that-does-not-exist.md)),
and its spacing, typography and component shapes did not match the
calm, dense-but-readable clinical target the hackathon frontend
`blood-connect-ui` established. Every screen was going to need a
restyle anyway once the volunteer public board (P9) arrived, and
maintaining UX4G alongside a second, screen-specific styling layer was
strictly worse than one owned kit.

`blood-connect-ui` was written as an independent frontend for the
same domain, with a polished component set — DataTable, FilterBar,
Modal, ConfirmDialog, form fields, Toast, StatusBadge, Timeline,
AppShell, Sidebar — a light-only clinical palette, and medical red
used only as an accent. Every piece of its visual language transfers
cleanly. Its API layer (SWR, mock services, `hooks/`, `lib/api/`,
`lib/auth/`) does **not** transfer, because Bloodconnect writes
through server actions against real Postgres, and the boundary rules
of §11.2 forbid a package reaching across the shape a service layer
would create.

## Decision

UX4G is removed from both apps. A new workspace package
`@blood-connect/ui` holds design tokens, primitives, and the
`AppShell` + `Sidebar` shell, sourced from `blood-connect-ui`. The
kit is presentation-only: it may not import from `packages/domain`,
`platform`, `hospital`, `centre`, `bot`, `contract`, `config`, `ids`,
`result` or `db`, enforced by dependency-cruiser
(`ui-is-presentation-only`).

`apps/web` uses a medical-red accent; `apps/admin` uses a slate-blue
accent. Both apps import the same base tokens plus one accent
overlay, so a screen from one is immediately distinguishable from the
other on a shared workstation — an operational property, not a visual
one. The accent tokens use the same names as the kit's primary tokens
(`--color-primary`, `--color-primary-hover`, `--color-primary-soft`,
`--color-primary-ring`), so a single component file renders in the
right accent per app without conditionals.

Typography ships through `next/font` (Geist), bundled at build time,
so the offline-first PWA promise of [ADR 0004](0004-pwa-and-a-spacing-token-that-does-not-exist.md)
(shell cached, data never) holds.

The kit's tokens are declared in Tailwind v4 `@theme` blocks so the
apps get both custom properties and matching utility classes
(`bg-canvas`, `text-ink`, `rounded-card`, `shadow-card`, …). Tailwind
is added per-app rather than in the kit, because a package cannot
install a Next PostCSS plugin into its consumers.

## Rolled out incrementally

- **PR-01 (shipped).** Lands `packages/ui/` with tokens as `:root`
  declarations, the boundary rule, the workspace dependency, and this
  ADR. Nothing renders differently: no app imports the kit's CSS yet,
  UX4G stays, `pnpm verify` stays green.

- **PR-02a (shipped).** Ports the primitives (Button, StatusBadge,
  DataTable, FilterBar, form fields, Card / StatCard / DescList /
  Timeline, Modal, ConfirmDialog, PageHeader, states, Toast) and the
  shell (AppShell, SidebarContent) into the kit. Rewrites the four
  token files from PR-01 into Tailwind v4 `@theme` blocks and renames
  the per-app accent tokens from `--color-accent*` to
  `--color-primary*` to match the ported components' expectations.
  Still no app imports the kit at runtime; still green.

- **PR-02b (this change).** Adds Tailwind v4 + `@tailwindcss/postcss`
  to `apps/web`, wires `apps/web/src/app/layout.tsx` to import the
  kit's tokens alongside the existing UX4G, loads Geist through the
  `geist` npm package (Vercel's official wrapper around `next/font`),
  and restyles the sign-in page + form as the first showcase screen.
  The sign-in page drops the UX4G AppShell wrap: an unauthenticated
  visitor has no navigation to render, so a centred card on the canvas
  is the whole page. UX4G stays in the layout for every other screen,
  which is why this PR touches only sign-in.

- **PR-03 onward (shipped through the whole of `apps/web`'s page
  chrome, as of 2026-09-21).** One screen per PR: sign-in, landing,
  public board (P4); invite/reset/confirm-email (P5); admissions,
  patients, doctor role (P6); auth adjuncts, hospital-forms split
  (P7); centre shell + home (P8); volunteer role, all centre pages
  onto the shell, centre/stock (P9); centre/requests + attach-patient
  (P10); a shared `linkButtonClasses` helper plus centre/donations,
  centre/quarantine, centre/tags, centre/demands + its roster view
  (P11–P14). No screen shipped with a feature regression: where the
  ported blood-connect-ui screen was thinner than Bloodconnect's
  reality (e.g. its integer inventory versus this system's
  `blood_bags` with expiry, RFID, quarantine and discards), the
  ported UI was redesigned to display the real data in the same
  visual language. **The forms pass (P15, shipped 2026-09-21)**
  restyled the forms embedded in those pages — `centre-collision-forms.tsx`
  (nine forms), `centre-forms.tsx` (six forms), `hospital-forms.tsx`'s
  `AdmissionForm` — which had been left UX4G-styled inside kit-styled
  pages through P14, by design (see "A restyled page wrapping a
  still-UX4G form is expected" — that was the accepted intermediate
  state, not an oversight). It also fixed the third bug below, found
  while verifying it.

- **Admin app.** Not started as of 2026-09-21. Entire `apps/admin`
  is still on UX4G, including its sign-in.

- **Final PR.** Removes `ux4g-runtime.tsx` and the
  `ux4g-web-components` npm dependency from both apps, replaces both
  apps' `theme.css` with a one-line import of the kit's aggregate,
  and imports `@blood-connect/ui/tokens/preflight.css` at that point
  (deferred until UX4G is gone so its own body/heading resets do not
  double up).

## Progress (as of 2026-09-21)

**Shipped**, on `feat/ui-kit`, not yet merged: PR-01/02a/02b, PR-03
through PR-10 (sign-in through centre/requests), `linkButtonClasses`
(PR-11a), PR-11 through PR-14 (donations, quarantine, tags, demands +
roster), and P15 (the forms pass). Commit-by-commit detail lives in
this branch's session handoff notes, not here.

**Three bugs the rollout surfaced, all worth knowing before touching
this kit again:**

1. **Unlayered legacy CSS beat every Tailwind utility, site-wide,
   from the very first PR that wired Tailwind in.** `layout.tsx` was
   importing `ux4g-web-components/styles.css` and `./theme.css` as
   bare `.tsx` side-effect imports. Turbopack bundles those
   unprocessed by PostCSS and — critically — unlayered, and per the
   CSS Cascading Layers spec an unlayered rule beats a layered one
   regardless of specificity or source order. UX4G's zero-specificity
   `:where(*) { border: 0; margin: 0; padding: 0; ... }` reset was
   silently overriding every kit utility that touches those
   properties, on every restyled page, the whole time — inputs with
   no border, buttons with no background, pill-links collapsed flat.
   Fixed by wrapping both legacy stylesheets in an explicit
   `@import ... layer(legacy);` (`apps/web/src/app/legacy-styles.css`)
   imported before `tailwind.css`, so the `legacy` layer registers
   lowest. **Apply the same pattern to `apps/admin` from its first
   Tailwind-wiring commit** — it currently imports UX4G the same bare
   way and will hit the identical bug the moment Tailwind lands there.
2. **A kit component marked `'use client'` rejects a function-valued
   prop from any Server Component ancestor, and none of `pnpm
   verify`, typecheck, lint, or tests catch it — only opening the
   page in a browser does.** `DataTable`'s `columns` prop (each
   `Column.cell` is a function) and `FormField`'s render-prop
   `children` both hit Next.js's RSC rule that a Server Component may
   not pass a function to a `'use client'` boundary. `DataTable` had
   been marked `'use client'` out of caution despite having no hooks
   or browser API; that turned every Server Component page building a
   `columns` array into a runtime crash the moment it rendered.
   Confirmed live at `/centre/requests`
   ("Functions are not valid as a child of Client Components").
   Fixed by removing `'use client'` from `DataTable.tsx` (its only
   client-requiring feature, an optional `onRowClick`, no call site
   uses) and adding it to `request-lookup-form.tsx`, the one caller
   that invoked `FormField` from outside a client boundary. Both
   fixes are committed. **General rule going forward**: any kit
   component whose props can include a function needs a deliberate
   answer on whether it should be `'use client'`; if it is, every
   Server Component that builds that function and renders it must
   itself become a Client Component.
3. **A `'use client'` form imported one pure function from a
   server-only use-case module, and that pulled Postgres and native
   crypto bindings into the browser bundle.** `centre-collision-forms.tsx`
   needs `allowedOutcomes` / `defaultOutcome` / `StorageBand` — three
   dependency-free functions and a type — to grey out the impossible
   return outcome client-side. They lived in
   `packages/centre/src/use-cases/returns.ts`, alongside `returnBag`
   and friends, which import `drizzle-orm`, `@blood-connect/db` and
   `@blood-connect/platform` (and, transitively, `postgres` and
   `@node-rs/argon2`). ES module evaluation does not skip a file's own
   imports just because the importer only uses one tree-shakeable
   export from it, so bundling `centre-collision-forms.tsx` for the
   browser tried to bundle `postgres`'s `net`/`tls` imports and
   `@node-rs/argon2`'s native binary too, and failed. In dev, Turbopack
   swallowed the failure and served a wrong, misleading symptom
   instead: every route reachable through that form (`/centre/tags`,
   `/centre/quarantine`, `/centre/stock`, `/centre/demands/[id]`)
   500'd with `ENOENT ... build-manifest.json`, which reads exactly
   like a stuck dev-server cache and **is not one** — a `pnpm dev`
   restart, even a clean `rm -rf .next`, reproduced it every time.
   `pnpm build` (Turbopack's production compiler) reported the real
   error immediately: `Export hash doesn't exist in target module`
   and `net`/`tls` module-not-found, with an import trace running
   through `centre-collision-forms.tsx`. Fixed by extracting the pure
   rule into `packages/centre/src/rules/returns.ts` (no DB or platform
   imports) and a new `@blood-connect/centre/rules/returns` package
   export; `use-cases/returns.ts` now imports and re-exports from
   there so its own public API is unchanged, and the client form
   imports the rules subpath directly instead of the package barrel.
   **General rule going forward**: a `'use client'` component may only
   import from a module that is itself free of server-only imports,
   all the way down — checking the export you use is not enough, the
   *module's own top-level imports* are what get bundled. When a
   dev-only 500 mentions `build-manifest.json` or another Turbopack
   cache file, do not trust that it is a cache problem before running
   `pnpm build` (or a clean `.next`) to see the real compiler error;
   the manifest error is a downstream symptom of a bundling failure,
   not its cause, and can survive any number of dev-server restarts.

**Not yet done**: all of `apps/admin`; the final cleanup PR.

## What did NOT come across from blood-connect-ui

- **`badges.tsx`** (domain-enum badge wrappers). Those depend on
  enums that live in Bloodconnect's `packages/domain` and
  `packages/contract`, not on any concept in the kit. They will land
  as a per-app file (e.g. `apps/web/src/ui/badges.tsx`) when the
  first screen needs them.
- **`AuthProvider` / `SWRConfig` / `Providers`.** Bloodconnect has no
  client auth context; the actor is a server-side read. The kit stays
  out of it.
- **`hooks/`, `lib/api/`, `lib/api/mock/`, `lib/auth/`.** These are a
  client-side service layer for a mocked backend, and Bloodconnect's
  boundary rules forbid the shape they create.

## Supersedes

[ADR 0004](0004-pwa-and-a-spacing-token-that-does-not-exist.md)'s
assertion that UX4G's spacing tokens are the kit's spacing tokens.
The `data-theme="light"` attribute on `<html>` stays — the kit is
light-only for the same shared-workstation reason UX4G was, and future
components read the attribute for the same purpose ADR 0004
described. Every other decision in ADR 0004 (PWA behaviour,
service-worker caching, icon regeneration) is unaffected.

## Consequences

- One CSS pipeline to reason about, and one dependency to update. The
  UX4G npm package is dropped from both apps in the final PR of the
  series.
- The kit does not know about database rows, so a badge cannot leak
  the shape of an audit row: the §14 "403 carries no data" property
  is easier to keep true.
- Two apps share one visual language; a component fixed in the kit is
  fixed in both.
- The blood-connect-ui hackathon frontend becomes the visual
  reference from here on; its API/SWR/mock layer stays in that repo
  and is not copied here, because Bloodconnect writes through server
  actions.
- The centre's richer domain (bag-level stock, RFID, quarantine,
  discards, walk-ins) is preserved: the ported UI adapts to it rather
  than the other way round.
- The doctor app stays a request slip
  ([ADR 0010](0010-the-doctor-app-becomes-a-request-slip.md)); the
  restyle changes its clothes, not its shape.
