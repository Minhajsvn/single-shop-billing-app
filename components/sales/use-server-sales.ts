"use client";

import { useEffect, useState } from "react";
import type { SaleRow } from "@/lib/lists/merge-results";

export type ServerSales = { status: "idle" | "loading" | "loaded" | "error"; rows: SaleRow[]; total: number };

const EMPTY: ServerSales = { status: "idle", rows: [], total: 0 };

/** Debounced owner-only server search for "This year" and "All" (sales older than the browser's 90 days). */
export function useServerSales(enabled: boolean, query: string, range: { from: string | null; to: string }, page: number, refreshKey: number): ServerSales {
  const [result, setResult] = useState<ServerSales>(EMPTY);
  const { from, to } = range;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const loading = window.setTimeout(() => { if (!cancelled) setResult((current) => ({ ...current, status: "loading" })); }, 0);
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: query.trim(), to, page: String(page) });
      if (from) params.set("from", from);
      fetch(`/api/v1/sales/search?${params}`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error(String(response.status));
          const body = await response.json() as { rows: SaleRow[]; total: number };
          if (!cancelled) setResult({ status: "loaded", rows: body.rows, total: body.total });
        })
        .catch(() => { if (!cancelled) setResult({ status: "error", rows: [], total: 0 }); });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(loading);
      window.clearTimeout(timer);
    };
    // refreshKey: the number of this browser's unsynced sales. When one syncs it leaves the local merge, so the
    // server results must be fetched again or the sale would vanish until the next search.
  }, [enabled, query, from, to, page, refreshKey]);

  return enabled ? result : EMPTY;
}
