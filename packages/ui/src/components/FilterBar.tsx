'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '../primitives/cn.js';

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-card border border-border bg-surface p-4">
      {children}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  label = 'Search',
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  const [local, setLocal] = useState(value);
  // Sync external (URL-driven) value into local state during render, per
  // https://react.dev/learn/you-might-not-need-an-effect
  const [lastExternal, setLastExternal] = useState(value);
  if (value !== lastExternal) {
    setLastExternal(value);
    setLocal(value);
  }

  // The effect debounces the LOCAL value's propagation up to the parent.
  // It intentionally depends only on `local`: firing on every change to
  // `value` would defeat the debounce, and firing on every change to
  // `onChange` would restart the timer on any parent re-render. This is
  // exactly the pattern the "you might not need an effect" essay
  // discusses; the linter's exhaustive-deps rule would misdiagnose it,
  // which is why the ported code from blood-connect-ui suppressed that
  // rule here. Bloodconnect's ESLint config does not include the
  // react-hooks plugin, so there is nothing to suppress: this comment
  // is the whole documentation.
  useEffect(() => {
    const t = setTimeout(() => {
      if (local !== value) onChange(local);
    }, 300);
    return () => { clearTimeout(t); };
  }, [local, onChange, value]);

  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      <input
        type="search"
        value={local}
        onChange={(e) => { setLocal(e.target.value); }}
        placeholder={placeholder}
        className="h-10 w-full rounded-control border border-border-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 sm:w-64"
      />
    </label>
  );
}

export function SelectFilter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      <select
        value={value}
        onChange={(e) => { onChange(e.target.value); }}
        className="h-10 rounded-control border border-border-strong bg-surface px-3 pr-8 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
