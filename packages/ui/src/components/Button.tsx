import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../primitives/cn.js';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-primary text-white hover:bg-primary-hover disabled:bg-primary/50 border border-transparent',
  secondary:
    'bg-surface text-ink border border-border-strong hover:bg-surface-muted disabled:opacity-50',
  ghost:
    'bg-transparent text-ink-muted hover:bg-surface-muted border border-transparent disabled:opacity-50',
  danger:
    'bg-danger text-white hover:opacity-90 disabled:opacity-50 border border-transparent',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        VARIANTS[variant],
        SIZES[size],
        (disabled ?? loading) && 'cursor-not-allowed',
        className,
      )}
    >
      {loading && (
        <span
          aria-hidden
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}
