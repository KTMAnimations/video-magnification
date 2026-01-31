import { useEffect, useState } from 'react';
import { subscribeToasts } from '../toast';
import type { ToastItem } from '../toast';

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handler = (toast: ToastItem) => {
      setToasts((prev) => [...prev, toast]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, 6000);
    };
    const unsubscribe = subscribeToasts(handler);
    return unsubscribe;
  }, []);

  if (toasts.length === 0) return null;

  const colorMap = {
    warning: 'var(--color-warning)',
    error: 'var(--color-danger)',
    success: 'var(--color-accent)',
  };

  return (
    <div className="fixed top-14 right-4 z-50 space-y-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="p-3 rounded border text-[0.7rem] leading-snug animate-slide-in"
          style={{
            backgroundColor: 'var(--color-bg-secondary)',
            borderColor: colorMap[t.type],
            color: colorMap[t.type],
          }}
        >
          <button
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            className="float-right ml-2 opacity-50 hover:opacity-100"
          >
            &#10005;
          </button>
          {t.message}
        </div>
      ))}
    </div>
  );
}
