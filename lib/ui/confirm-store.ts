export type ConfirmRequest = {
  id: string;
  title: string;
  body: string;
  confirmLabel: string;
  /** Red confirm button, and focus starts on Cancel. */
  destructive?: boolean;
  resolve: (ok: boolean) => void;
};

let requests: ConfirmRequest[] = [];
let counter = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/** In-app replacement for window.confirm: resolves true when confirmed, false when cancelled. */
export function requestConfirm(options: Omit<ConfirmRequest, "id" | "resolve">): Promise<boolean> {
  return new Promise((resolve) => {
    requests = [...requests, { ...options, id: `confirm-${++counter}`, resolve }];
    notify();
  });
}

export function answerConfirm(id: string, ok: boolean) {
  const request = requests.find((item) => item.id === id);
  if (!request) return;
  requests = requests.filter((item) => item.id !== id);
  notify();
  request.resolve(ok);
}

export function getConfirms(): ConfirmRequest[] {
  return requests;
}

const NO_CONFIRMS: ConfirmRequest[] = [];
export const getServerConfirms = () => NO_CONFIRMS;

export function subscribeConfirms(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
