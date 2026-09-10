# 0015 · UX4G replaced by an in-repo clinical kit

**Status.** Accepted.

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

- **PR-02a (this change).** Ports the primitives (Button,
  StatusBadge, DataTable, FilterBar, form fields, Card / StatCard /
  DescList / Timeline, Modal, ConfirmDialog, PageHeader, states,
  Toast) and the shell (AppShell, SidebarContent) into the kit.
  Rewrites the four token files from PR-01 into Tailwind v4 `@theme`
  blocks and renames the per-app accent tokens from `--color-accent`
  to `--color-primary` to match the ported components' expectations.
  Still no app imports the kit at runtime; still green.

- **PR-02b (next).** Adds Tailwind v4 + `@tailwindcss/postcss` to
  `apps/web`, wires `apps/web/src/app/layout.tsx` to import the kit's
  tokens alongside the existing UX4G, loads Geist through `next/font`,
  and restyles the sign-in page + form as the first showcase screen.

- **PR-03 onward.** One screen per PR (dashboard, centre home,
  centre requests, centre stock, centre donations, demands,
  quarantine, tags, settings, volunteer, board, doctor role-home,
  admissions, patients, requests, profile, all the ancillary
  sign-in / invite / reset / confirm-email / offline / forbidden
  pages; then all admin screens the same way, closing with admin's
  UX4G removal). No screen ships with feature regressions: when the
  ported blood-connect-ui screen is thinner than Bloodconnect's
  reality (e.g. its integer inventory versus this system's
  `blood_bags` with expiry, RFID, quarantine and discards), the
  ported UI is redesigned to display the real data in the same visual
  language.

- **Final PR.** Removes `ux4g-runtime.tsx` and the
  `ux4g-web-components` npm dependency from both apps, replaces both
  apps' `theme.css` with a one-line import of the kit's aggregate.

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
