import { cn } from '../primitives/cn.js';
import { type Tone } from '../primitives/types.js';

const TONES: Record<Tone, string> = {
  neutral: 'bg-neutral-soft text-neutral border-neutral/20',
  info: 'bg-info-soft text-info border-info/20',
  success: 'bg-success-soft text-success border-success/20',
  warning: 'bg-warning-soft text-warning border-warning/20',
  danger: 'bg-danger-soft text-danger border-danger/20',
  primary: 'bg-primary-soft text-primary border-primary/20',
};

const DOT: Record<Tone, string> = {
  neutral: 'bg-neutral',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  primary: 'bg-primary',
};

export function StatusBadge({
  label,
  tone = 'neutral',
  className,
}: {
  label: string;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      <span aria-hidden className={cn('size-1.5 rounded-full', DOT[tone])} />
      {label}
    </span>
  );
}
