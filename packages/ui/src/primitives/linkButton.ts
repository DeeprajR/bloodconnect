import { cn } from './cn.js';

export type LinkButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type LinkButtonSize = 'sm' | 'md' | 'lg';

// Mirrors <Button>'s VARIANTS (components/Button.tsx) minus the
// `disabled:` classes, which don't apply to an <a>.
const VARIANTS: Record<LinkButtonVariant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-hover border border-transparent',
  secondary: 'bg-surface text-ink border border-border-strong hover:bg-surface-muted',
  ghost: 'bg-transparent text-ink-muted hover:bg-surface-muted border border-transparent',
  danger: 'bg-danger text-white hover:opacity-90 border border-transparent',
};

// `sm`/`md` mirror <Button>'s SIZES exactly. `lg` is the taller, wider
// size used by full-bleed CTAs (landing page, confirm-email) that
// <Button> itself has no equivalent for.
const SIZES: Record<LinkButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-5 text-sm',
};

export interface LinkButtonClassesOptions {
  variant?: LinkButtonVariant;
  size?: LinkButtonSize;
  className?: string;
}

/**
 * Class string for a `<Link>` (or any `<a>`) that must look like
 * `<Button>`. Kit's `<Button>` always renders a `<button>` element, so a
 * navigation link can't render the component directly — this returns
 * just its visual shape instead.
 *
 * `no-underline` is included unconditionally: a styled anchor inherits
 * the browser's default underline unless it's stripped explicitly,
 * which `<Button>` never has to think about because a `<button>` has no
 * such default (see the ui-kit-migration handoff doc, gotcha #6).
 *
 * This intentionally has no `disabled` handling. A link that must render
 * disabled needs `aria-disabled` plus its own pointer-events/opacity at
 * the call site — this helper only reproduces the enabled look.
 */
export function linkButtonClasses({
  variant = 'primary',
  size = 'md',
  className,
}: LinkButtonClassesOptions = {}): string {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-control font-medium no-underline transition-colors',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}
