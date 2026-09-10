// @blood-connect/ui — the in-repo clinical design system that replaces UX4G
// (ADR 0015). PR-01 ships design tokens only; primitives (Button, DataTable,
// FilterBar, Modal, ConfirmDialog, form fields, Toast, states, AppShell,
// Sidebar) arrive in PR-02 and land in ./components and ./shell.
//
// The kit is presentation-only: it may not import from packages/domain,
// platform, hospital, centre, bot, contract, config, ids, result or db.
// Enforced by dependency-cruiser (see `ui-is-presentation-only`).

export {};
