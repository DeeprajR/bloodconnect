import { type ReactNode } from 'react';
import { cn } from '../primitives/cn.js';

export function Card({
  title,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        'rounded-card border border-border bg-surface shadow-card',
        className,
      )}
    >
      {(title ?? actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          {title && (
            <h2 className="text-sm font-semibold text-ink">{title}</h2>
          )}
          {actions}
        </header>
      )}
      <div className={cn('p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'neutral' | 'danger' | 'warning' | 'success';
}) {
  const toneClass = {
    neutral: 'text-ink',
    danger: 'text-danger',
    warning: 'text-warning',
    success: 'text-success',
  }[tone];
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
        {label}
      </p>
      <p className={cn('mt-1 text-2xl font-semibold tabular-nums', toneClass)}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

export function DescList({
  items,
}: {
  items: { term: string; value: ReactNode }[];
}) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.term}>
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
            {it.term}
          </dt>
          <dd className="mt-0.5 text-sm text-ink">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Timeline({
  steps,
}: {
  steps: {
    label: string;
    at?: string | null;
    state: 'done' | 'current' | 'upcoming';
    detail?: string;
  }[];
}) {
  return (
    <ol className="space-y-0">
      {steps.map((step, i) => (
        <li key={`${step.label}-${String(i)}`} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span
              aria-hidden
              className={cn(
                'mt-0.5 flex size-4 items-center justify-center rounded-full border-2 text-[10px]',
                step.state === 'done' &&
                  'border-success bg-success text-white',
                step.state === 'current' &&
                  'border-primary bg-primary-soft text-primary',
                step.state === 'upcoming' &&
                  'border-border-strong bg-surface text-transparent',
              )}
            >
              {step.state === 'done' ? '✓' : ''}
            </span>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  'w-0.5 flex-1',
                  step.state === 'done' ? 'bg-success' : 'bg-border-strong',
                )}
              />
            )}
          </div>
          <div className="pb-5">
            <p
              className={cn(
                'text-sm',
                step.state === 'upcoming'
                  ? 'text-ink-subtle'
                  : 'font-medium text-ink',
              )}
            >
              {step.label}
              <span className="sr-only"> — {step.state}</span>
            </p>
            {step.at && (
              <p className="text-xs text-ink-muted">{step.at}</p>
            )}
            {step.detail && (
              <p className="text-xs text-ink-muted">{step.detail}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
