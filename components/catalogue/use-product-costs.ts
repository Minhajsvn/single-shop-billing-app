"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchProductCosts } from "@/lib/profit/client";

/**
 * Stage 2C: the shop's product costs for an owner or manager on Pro, fetched online when the page opens and kept in
 * memory only (never IndexedDB, so a till's storage never holds them).
 */
export function useProductCosts(enabled: boolean) {
  const [costs, setCosts] = useState<Map<string, number> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    // Deferred so the effect body does not set state synchronously.
    const timer = window.setTimeout(() => {
      setLoading(true);
      void fetchProductCosts().then((result) => {
        if (!live) return;
        setLoading(false);
        if (result.ok) {
          setCosts(result.costs);
          setError("");
        } else setError(result.error);
      });
    }, 0);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [enabled, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const set = useCallback((productId: string, costFils: number | null) => {
    setCosts((current) => {
      const next = new Map(current ?? []);
      if (costFils === null) next.delete(productId);
      else next.set(productId, costFils);
      return next;
    });
  }, []);

  return { costs: enabled ? costs : null, loading: enabled && loading, error: enabled ? error : "", reload, set };
}
