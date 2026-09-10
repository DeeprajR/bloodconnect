'use client';

/**
 * Lightweight, accessible toast notifications for action feedback.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastContextValue {
  notify: (tone: ToastTone, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    (tone: ToastTone, message: string) => {
      const id = ++counter;
      setItems((prev) => [...prev, { id, tone, message }]);
      setTimeout(() => { dismiss(id); }, 5000);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
        role="region"
        aria-label="Notifications"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={[
              'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-control border px-4 py-3 shadow-overlay',
              t.tone === 'success'
                ? 'border-success/30 bg-success-soft text-success'
                : t.tone === 'error'
                  ? 'border-danger/30 bg-danger-soft text-danger'
                  : 'border-info/30 bg-info-soft text-info',
            ].join(' ')}
          >
            <span aria-hidden className="mt-0.5 text-sm font-bold">
              {t.tone === 'success' ? '✓' : t.tone === 'error' ? '!' : 'i'}
            </span>
            <p className="flex-1 text-sm text-ink">{t.message}</p>
            <button
              type="button"
              onClick={() => { dismiss(t.id); }}
              className="text-ink-subtle hover:text-ink"
              aria-label="Dismiss notification"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}
