export type Toast = { id: string; message: string; tone?: "ok" | "info" };

export const TOAST_MS = 4000;
export const MAX_TOASTS = 3;

/** Keeps the newest `max` toasts. */
export function pushToast(queue: Toast[], toast: Toast, max = MAX_TOASTS): Toast[] {
  return [...queue, toast].slice(-max);
}

type Timer = (callback: () => void, ms: number) => unknown;

/** A small external store for short confirmations ("Product saved"); errors that need action stay on the page. */
export function createToastStore(setTimer: Timer = (callback, ms) => setTimeout(callback, ms)) {
  let toasts: Toast[] = [];
  let counter = 0;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  function dismissToast(id: string) {
    const next = toasts.filter((toast) => toast.id !== id);
    if (next.length === toasts.length) return;
    toasts = next;
    notify();
  }

  function toast(message: string, tone: Toast["tone"] = "ok") {
    const id = `toast-${++counter}`;
    toasts = pushToast(toasts, { id, message, tone });
    notify();
    setTimer(() => dismissToast(id), TOAST_MS);
  }

  return {
    toast,
    dismissToast,
    getToasts: () => toasts,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

const store = createToastStore();
export const toast = store.toast;
export const dismissToast = store.dismissToast;
export const getToasts = store.getToasts;
export const subscribeToasts = store.subscribe;
const NO_TOASTS: Toast[] = [];
/** Server render: never any toasts. */
export const getServerToasts = () => NO_TOASTS;
