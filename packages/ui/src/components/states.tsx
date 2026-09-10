import { type ReactNode } from 'react';
import { cn } from '../primitives/cn.js';
import { Button } from './Button.js';

export function LoadingSkeleton({
  rows = 5,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-11 animate-pulse rounded-control bg-surface-muted"
        />
      ))}
    </div>
  );
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-3 rounded-card border border-border bg-surface p-10 text-sm text-ink-muted"
    >
      <span
        aria-hidden
        className="size-4 animate-spin rounded-full border-2 border-ink-subtle border-t-transparent"
      />
      {label}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-card border border-danger/30 bg-danger-soft p-8 text-center"
    >
      <span aria-hidden className="text-lg font-bold text-danger">
        !
      </span>
      <div>
        <p className="font-medium text-ink">{title}</p>
        {message && <p className="mt-1 text-sm text-ink-muted">{message}</p>}
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-border-strong bg-surface p-10 text-center">
      <p className="font-medium text-ink">{title}</p>
      {description && (
        <p className="max-w-sm text-sm text-ink-muted">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
