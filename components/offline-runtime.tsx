"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { shouldAutoSync } from "@/lib/sync/auto-sync";
import { isSyncing, reconcilePendingOperations, refreshSnapshot, subscribeSyncing, useDemoStore, useShopContext } from "@/lib/demo-store";
import { shouldRefresh } from "@/lib/promotions/refresh";
import { productSyncProblems } from "@/lib/store/product-sync";
import { categorySyncProblems } from "@/lib/catalogue/categories";
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
    const categoryProblems = categorySyncProblems(store.syncOperations).size;
    const otherFailed = store.syncOperations.filter((operation) => operation.status === "failed" && operation.entity !== "product" && operation.entity !== "stock" && operation.entity !== "category").length;
    const status = syncStatus({ mode, online, pending, needAttention: productProblems + categoryProblems + otherFailed, syncing });
    // Refused products and categories are explained on Inventory; anything else under Settings → Data.
    return { ...status, href: productProblems || categoryProblems ? "/inventory" : "/settings?tab=data" };
  }, [mode, online, store.syncOperations, syncing]);
}

/** Registers the service worker and syncs pending changes whenever this device is online. Renders nothing. */
export function OfflineRuntime({ ready = true }: { ready?: boolean }) {
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
    if (!shouldAutoSync({ ready, online, pending })) return;
    const timer = window.setTimeout(() => { void reconcilePendingOperations(); }, 900);
    return () => window.clearTimeout(timer);
  }, [ready, online, pending]);

  // Stage 2E: pick up shop changes (promotions, prices) while online: every 5 minutes and when the tab comes back.
  const { mode } = useShopContext();
  useEffect(() => {
    if (!ready || !online || mode !== "hosted") return;
    let lastAt = Date.now();
    const refresh = () => {
      if (!shouldRefresh(lastAt, Date.now())) return;
      lastAt = Date.now();
      void refreshSnapshot();
    };
    const timer = window.setInterval(refresh, 60_000);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      lastAt = 0;
      refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ready, online, mode]);

  return null;
}
