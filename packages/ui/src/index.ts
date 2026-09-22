// @blood-connect/ui — the in-repo clinical design system (ADR 0015).
//
// Presentation-only. The kit imports from React and next/link and
// nothing else. It may not reach into `packages/domain`, `platform`,
// `hospital`, `centre`, `bot`, `contract`, `config`, `ids`, `result`
// or `db`; the boundary rule `ui-is-presentation-only` in
// `.dependency-cruiser.cjs` fails the build if it does.
//
// Tokens live in `./tokens/*.css` and are consumed by the app layout,
// not from TypeScript — see the package README for the recommended
// import order.

export { cn } from './primitives/cn.js';
export { TONES, type Tone } from './primitives/types.js';
export {
  linkButtonClasses,
  type LinkButtonClassesOptions,
  type LinkButtonVariant,
  type LinkButtonSize,
} from './primitives/linkButton.js';

export { Button } from './components/Button.js';
export { StatusBadge } from './components/StatusBadge.js';
export { DataTable, type Column } from './components/DataTable.js';
export { FilterBar, SearchInput, SelectFilter } from './components/FilterBar.js';
export { FormField, TextInput, TextArea, Select } from './components/form.js';
export { Card, StatCard, DescList, Timeline } from './components/misc.js';
export { Overlay } from './components/Modal.js';
export { ConfirmDialog } from './components/ConfirmDialog.js';
export { PageHeader } from './components/PageHeader.js';
export {
  LoadingSkeleton,
  LoadingBlock,
  ErrorState,
  EmptyState,
} from './components/states.js';
export { ToastProvider, useToast } from './components/Toast.js';

export {
  AppShell,
  type AppShellProps,
  type NavItem,
} from './shell/AppShell.js';
export { SidebarContent, type SidebarProps } from './shell/Sidebar.js';
