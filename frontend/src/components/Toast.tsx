import { useEffect, useState } from 'react';
import { subscribeToasts } from '../toast';
import type { ToastItem } from '../toast';
import { AlertTriangle, AlertCircle, CheckCircle2, X } from 'lucide-react';

const iconMap = {
  warning: AlertTriangle,
  error: AlertCircle,
  success: CheckCircle2,
};

const borderColorMap = {
  warning: 'border-l-amber-500',
  error: 'border-l-red-500',
  success: 'border-l-emerald-500',
};

const iconColorMap = {
  warning: 'text-amber-500',
  error: 'text-red-500',
  success: 'text-emerald-500',
};

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

  return (
    <div className="fixed top-14 right-4 z-50 space-y-2 max-w-sm">
      {toasts.map((t) => {
        const Icon = iconMap[t.type];
        return (
          <div
            key={t.id}
            className={`bg-card shadow-md rounded-lg border border-l-4 ${borderColorMap[t.type]} p-3 text-sm leading-snug animate-slide-in flex items-start gap-2`}
          >
            <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${iconColorMap[t.type]}`} />
            <span className="flex-1 text-foreground">{t.message}</span>
            <button
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
