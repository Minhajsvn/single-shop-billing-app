"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { isSyncing, reconcilePendingOperations, subscribeSyncing, useDemoStore, useShopContext } from "@/lib/demo-store";
import { productSyncProblems } from "@/lib/store/product-sync";
import { syncStatus } from "@/lib/sync/status-text";

function subscribeOnline(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

function onlineSnapshot() { return navigator.onLine; }
function onlineServerSnapshot() { return true; }
const notSyncing = () => false;

/** Whether this device reports a network connection. */
export function useOnline() {
  return useSyncExternalStore(subscribeOnline, onlineSnapshot, onlineServerSnapshot);
}

/** The plain sync status line ("Online · all synced", "Offline · 8 waiting", "2 need attention") and where to look. */
export function useSyncStatusText() {
  const store = useDemoStore();
  const { mode } = useShopContext();
  const online = useSyncExternalStore(subscribeOnline, onlineSnapshot, onlineServerSnapshot);
  const syncing = useSyncExternalStore(subscribeSyncing, isSyncing, notSyncing);
  return useMemo(() => {
    const pending = store.syncOperations.filter((operation) => operation.status === "pending").length;
    const productProblems = productSyncProblems(store.syncOperations).size;
    const otherFailed = store.syncOperations.filter((operation) => operation.status === "failed" && operation.entity !== "product" && operation.entity !== "stock").length;
    const status = syncStatus({ mode, online, pending, needAttention: productProblems + otherFailed, syncing });
    // Refused products are explained on Inventory; anything else under Settings → Data.
    return { ...status, href: productProblems ? "/inventory" : "/settings?tab=data" };
  }, [mode, online, store.syncOperations, syncing]);
}

/** Registers the service worker and syncs pending changes whenever this device is online. Renders nothing. */
export function OfflineRuntime() {
  const store = useDemoStore();
  const online = useSyncExternalStore(subscribeOnline, onlineSnapshot, onlineServerSnapshot);
  const pending = store.syncOperations.filter((operation) => operation.status === "pending").length;

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "production") {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    } else {
      void navigator.serviceWorker.getRegistrations().then((registrations) => Promise.all(registrations.map((registration) => registration.unregister()))).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!online || pending === 0) return;
    const timer = window.setTimeout(() => { void reconcilePendingOperations(); }, 900);
    return () => window.clearTimeout(timer);
  }, [online, pending]);

  return null;
}
