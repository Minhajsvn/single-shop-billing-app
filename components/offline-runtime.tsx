"use client";

import { useEffect, useSyncExternalStore } from "react";
import { reconcilePendingOperations, useDemoStore } from "@/lib/demo-store";

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

  return <div className={`sync-state ${online ? "" : "offline"}`} title={online ? "This device is connected; supported changes sync automatically when available." : "Sales are being saved to this device."}><span className="sync-dot" />{online ? pending ? `${pending} pending · syncing when available` : "Device ready · local cache" : `${pending} pending · working offline`}</div>;
}
