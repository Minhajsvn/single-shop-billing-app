"use client";

import { useEffect, useState } from "react";
import type { Sale } from "@/lib/domain";

export type RemoteSale = { status: "idle" | "loading" | "loaded" | "missing" | "error"; sale: Sale | null };

/** Loads one sale from the server when this browser does not hold it (older than its 90-day history). */
export function useRemoteSale(id: string, enabled: boolean, online: boolean): RemoteSale {
  const [remote, setRemote] = useState<RemoteSale>({ status: "idle", sale: null });

  useEffect(() => {
    if (!enabled || !online) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setRemote({ status: "loading", sale: null });
      fetch(`/api/v1/sales/${encodeURIComponent(id)}`, { cache: "no-store" })
        .then(async (response) => {
          if (cancelled) return;
          if (response.status === 404) return setRemote({ status: "missing", sale: null });
          if (!response.ok) return setRemote({ status: "error", sale: null });
          const body = await response.json() as { sale?: Sale };
          if (!cancelled) setRemote(body.sale ? { status: "loaded", sale: body.sale } : { status: "missing", sale: null });
        })
        .catch(() => { if (!cancelled) setRemote({ status: "error", sale: null }); });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, id, online]);

  return remote;
}
