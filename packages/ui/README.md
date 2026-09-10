# @blood-connect/ui

The in-repo clinical design system used by both applications. Replaces
UX4G ([ADR 0015](../../docs/adr/0015-ux4g-replaced-by-in-repo-clinical-kit.md)).

Presentation-only: this package may not import from `packages/domain`,
`platform`, `hospital`, `centre`, `bot`, `contract`, `config`, `ids`,
`result` or `db`. Enforced by dependency-cruiser
(`ui-is-presentation-only`).

## What ships here

### Tokens (`src/tokens/`)

| File | What it holds |
|---|---|
| `base.css` | Shared clinical palette (surfaces, ink, status, radii, shadows), declared as a Tailwind v4 `@theme` block so both custom properties and utility classes are emitted. |
| `accent-medical.css` | `--color-primary*` = medical red. For `apps/web`. |
| `accent-admin.css` | `--color-primary*` = slate/blue. For `apps/admin`. |
| `typography.css` | `--font-sans` / `--font-mono`, reading `--font-geist-sans` / `--font-geist-mono` that each app's `next/font` call sets. |
| `preflight.css` | Body background, font, focus ring. Not part of Tailwind's own preflight. |
| `index.css` | Aggregate of base + typography + preflight, for tests/previews. |

### Components (`src/components/`)

| File | Exports | Notes |
|---|---|---|
| `Button.tsx` | `Button` | Variants: primary, secondary, ghost, danger. Sizes: sm, md. `loading` renders a spinner. |
| `StatusBadge.tsx` | `StatusBadge` | Reads a `Tone`; renders label + shaped dot. |
| `DataTable.tsx` | `DataTable`, `Column` | Real table on md+; stacked cards on mobile. |
| `FilterBar.tsx` | `FilterBar`, `SearchInput` (300ms debounce), `SelectFilter` | Client. |
| `form.tsx` | `FormField`, `TextInput`, `TextArea`, `Select` | `FormField` supplies `id` + `aria-describedby` through a render prop so any control gets a labelled, described binding. |
| `misc.tsx` | `Card`, `StatCard`, `DescList`, `Timeline` | |
| `Modal.tsx` | `Overlay` (variant: modal or drawer) | Focus trap (loose), Escape closes, body-scroll lock. |
| `ConfirmDialog.tsx` | `ConfirmDialog` | Wraps Overlay with a cancel/confirm footer and busy state. |
| `PageHeader.tsx` | `PageHeader` | H1 + description + actions row. |
| `states.tsx` | `LoadingSkeleton`, `LoadingBlock`, `ErrorState`, `EmptyState` | |
| `Toast.tsx` | `ToastProvider`, `useToast` | `notify(kind, message)`; auto-dismiss after 5s. |

### Shell (`src/shell/`)

| File | Exports | Notes |
|---|---|---|
| `Sidebar.tsx` | `SidebarContent`, `SidebarProps`, `NavItem` | Presentation of the sidebar. Takes `user`, `primaryNav`, `secondaryNav`, `currentPath`, `signOutSlot` as props. Knows nothing about auth. |
| `AppShell.tsx` | `AppShell`, `AppShellProps`, `NavItem` | Wraps `SidebarContent` with a mobile drawer and a sticky header. `currentTitle` and `headerSlot` are the caller's job to compute. |

### Deliberately not included

- **Domain badge wrappers** (blood-connect-ui's `badges.tsx`). Those
  wire enums (`REQUEST_STATUSES`, `APPOINTMENT_STATUSES`, …) to the
  kit's `StatusBadge` and belong in each app. Bloodconnect's enums
  live in `packages/domain` and `packages/contract`, so the wrappers
  will land in a per-app `src/ui/badges.tsx` when the first screen
  needs them.
- **Auth context / SWR providers / mock API.** blood-connect-ui
  wraps its app in `AuthProvider` + `SWRConfig`. Bloodconnect uses
  server actions and server components; there is no client auth
  context. The kit stays out of it.

## How the apps consume it

In PR-02a no app imports the kit's components yet — the primitives
land and become available. PR-02b wires `apps/web`'s layout and
restyles sign-in.

Expected `apps/web/src/app/layout.tsx` imports (added in PR-02b):

```ts
import 'ux4g-web-components/styles.css'; // still there
import './theme.css';                    // still there
import './tailwind.css';                 // new: `@import "tailwindcss"; @source "…";`
import '@blood-connect/ui/tokens/base.css';
import '@blood-connect/ui/tokens/accent-medical.css';
import '@blood-connect/ui/tokens/typography.css';
import '@blood-connect/ui/tokens/preflight.css';
```

Admin gets the same treatment (with `accent-admin.css`) when its
first screen is restyled.

## Client-vs-server

Components marked `"use client"` at the top of their file — because
they use `useState`, `useEffect`, refs, event handlers, or context:
`DataTable`, `FilterBar` (and its inputs), `form.tsx`, `Modal`,
`ConfirmDialog`, `Toast`, `AppShell`, `SidebarContent`.

Server-safe (renderable from a Server Component): `Button`,
`StatusBadge`, `Card`, `StatCard`, `DescList`, `Timeline`,
`PageHeader`, `LoadingSkeleton`, `LoadingBlock`, `ErrorState`,
`EmptyState`.
