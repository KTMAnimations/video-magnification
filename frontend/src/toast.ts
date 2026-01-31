export interface ToastItem {
  id: number;
  message: string;
  type: 'warning' | 'error' | 'success';
}

let nextId = 0;
const listeners: Set<(toast: ToastItem) => void> = new Set();

export function showToast(message: string, type: ToastItem['type'] = 'warning') {
  const toast: ToastItem = { id: nextId++, message, type };
  listeners.forEach((fn) => fn(toast));
}

export function subscribeToasts(handler: (toast: ToastItem) => void) {
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
  };
}
