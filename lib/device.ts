const DEVICE_KEY = "shop-ledger-device-v1";

export function getStoredDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(DEVICE_KEY); } catch { return null; }
}

export function storeDeviceId(id: string): void {
  try { window.localStorage.setItem(DEVICE_KEY, id); } catch { /* storage unavailable: the till picker will ask again */ }
}

export function clearStoredDeviceId(): void {
  try { window.localStorage.removeItem(DEVICE_KEY); } catch { /* ignore */ }
}
