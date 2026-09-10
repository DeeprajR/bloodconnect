# @blood-connect/ui

The in-repo clinical design system used by both applications. Replaces
UX4G ([ADR 0015](../../docs/adr/0015-ux4g-replaced-by-in-repo-clinical-kit.md)).

Presentation-only: this package may not import from `packages/domain`,
`platform`, `hospital`, `centre`, `bot`, `contract`, `config`, `ids`,
`result` or `db`. Enforced by dependency-cruiser
(`ui-is-presentation-only`).

## What ships in PR-01

Design tokens only. No components yet.

| File | What it holds |
|---|---|
| `src/tokens/base.css` | Shared clinical palette: surfaces, ink, status colours, radii, shadows. `:root` declarations only. |
| `src/tokens/accent-medical.css` | `--color-accent-*` = medical red, for the staff app. |
| `src/tokens/accent-admin.css` | `--color-accent-*` = slate/blue, for the administration app. |
| `src/tokens/typography.css` | `--font-sans` / `--font-mono`. Reads `--font-geist` that each app's `next/font` call sets. |
| `src/tokens/preflight.css` | Body background, font, focus ring. **Not** imported by the apps in PR-01. |
| `src/tokens/index.css` | Aggregate of base + typography + preflight, for tests/previews. |
| `src/index.ts` | Empty barrel. Components land in PR-02. |

## How the apps consume it

`apps/web` and `apps/admin` list `@blood-connect/ui` as a workspace
dependency in their `package.json`. In PR-01 no CSS file is imported by
either app yet — the package is registered but silent, so `pnpm verify`
stays green with no visible change.

PR-02 will add these imports to each app's `src/app/layout.tsx`:

```ts
// apps/web
import '@blood-connect/ui/tokens/base.css';
import '@blood-connect/ui/tokens/accent-medical.css';
import '@blood-connect/ui/tokens/typography.css';
import '@blood-connect/ui/tokens/preflight.css';

// apps/admin — same, but with accent-admin.css
```

## What lands next

PR-02: primitives (Button, StatusBadge, DataTable, FilterBar, Modal,
ConfirmDialog, form fields, Toast, states, misc) + `AppShell` and
`Sidebar`, sourced from the `blood-connect-ui` component kit. UX4G is
removed from `apps/web` in that PR.
