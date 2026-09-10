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

`blood-connect-ui` was written as an independent frontend for the same
domain, with a polished component set — DataTable, FilterBar, Modal,
ConfirmDialog, form fields, Toast, StatusBadge, Timeline, AppShell,
Sidebar — a light-only clinical palette, and medical red used only as
an accent. Every piece of its visual language transfers cleanly. Its
API layer (SWR, mock services, `hooks/`, `lib/api/`, `lib/auth/`) does
**not** transfer, because Bloodconnect writes through server actions
against real Postgres, and the boundary rules of §11.2 forbid a
package reaching across the shape a service layer would create.

## Decision

UX4G is removed from both apps. A new workspace package
`@blood-connect/ui` holds design tokens, primitives, and the
`AppShell` + `Sidebar` shell, sourced from `blood-connect-ui`. The
kit is presentation-only: it may not import from `packages/domain`,
`platform`, `hospital`, `centre`, `bot`, `contract`, `config`, `ids`,
`result` or `db`, enforced by dependency-cruiser
(`ui-is-presentation-only`).

`apps/web` uses a medical-red accent; `apps/admin` uses a slate-blue
accent. Both apps import the same base tokens plus one accent overlay,
so a screen from one is immediately distinguishable from the other on a
shared workstation — an operational property, not a visual one.

Typography ships through `next/font` (Geist), bundled at build time,
so the offline-first PWA promise of [ADR 0004](0004-pwa-and-a-spacing-token-that-does-not-exist.md)
(shell cached, data never) holds.

## Rolled out incrementally

- **PR-01 (this change).** Lands `packages/ui/` with tokens, the
  boundary rule, the workspace dependency, and this ADR. Nothing
  renders differently: no app imports the kit's CSS yet, UX4G stays,
  `pnpm verify` stays green. This is the smallest change that puts the
  package on the map.

- **PR-02.** Ports primitives + `AppShell`/`Sidebar`. Wires the app
  layouts to the kit's tokens (base + per-app accent + typography +
  preflight), removes `ux4g-runtime.tsx` and the UX4G npm dependency
  from `apps/web`, replaces its `theme.css` with a one-line import,
  restyles the sign-in page as the first screen using the kit.

- **PR-03 onward.** One screen per PR, per the sequence in the
  restyling plan (dashboard, centre home, centre requests, centre stock,
  centre donations, demands, quarantine, tags, settings, volunteer,
  board, doctor role-home, admissions, patients, requests, profile, all
  the ancillary sign-in / invite / reset / confirm-email / offline /
  forbidden pages; then all admin screens the same way, closing with
  admin's UX4G removal). No screen ships with feature regressions:
  when the ported blood-connect-ui screen is thinner than Bloodconnect's
  reality (e.g. its integer inventory versus this system's `blood_bags`
  with expiry, RFID, quarantine and discards), the ported UI is
  redesigned to display the real data in the same visual language.

## Supersedes

[ADR 0004](0004-pwa-and-a-spacing-token-that-does-not-exist.md)'s
assertion that UX4G's spacing tokens are the kit's spacing tokens. The
`data-theme="light"` attribute on `<html>` stays — the kit is
light-only for the same shared-workstation reason UX4G was, and future
components read the attribute for the same purpose ADR 0004 described.
Every other decision in ADR 0004 (PWA behaviour, service-worker
caching, icon regeneration) is unaffected.

## Consequences

- One CSS pipeline to reason about, and one dependency to update. The
  UX4G npm package is dropped from both apps in PR-02.
- The kit does not know about database rows, so a badge cannot leak the
  shape of an audit row: the §14 "403 carries no data" property is
  easier to keep true.
- Two apps share one visual language; a component fixed in the kit is
  fixed in both.
- The blood-connect-ui hackathon frontend becomes the visual reference
  from here on; its API/SWR/mock layer stays in that repo and is not
  copied here, because Bloodconnect writes through server actions.
- The centre's richer domain (bag-level stock, RFID, quarantine,
  discards, walk-ins) is preserved: the ported UI adapts to it rather
  than the other way round.
- The doctor app stays a request slip
  ([ADR 0010](0010-the-doctor-app-becomes-a-request-slip.md)); the
  restyle changes its clothes, not its shape.
