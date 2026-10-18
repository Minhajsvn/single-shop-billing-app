"use client";

import { useEffect, useState } from "react";

/**
 * List state (search, chip, page…) kept in the address bar so Back and refresh keep the place.
 * Read from window.location after mount (static pages, no Suspense boundary) and written with replaceState.
 */
export function useListParams<T extends Record<string, string>>(defaults: T): [T, (patch: Partial<T>) => void] {
  const [params, setParams] = useState<T>(defaults);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const search = new URLSearchParams(window.location.search);
      const next = { ...defaults };
      for (const key of Object.keys(defaults) as (keyof T)[]) {
        const value = search.get(String(key));
        if (value !== null) next[key] = value as T[keyof T];
      }
      setParams(next);
    }, 0);
    return () => window.clearTimeout(timer);
    // Read once on mount; later changes come from update().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(patch: Partial<T>) {
    const next = { ...params, ...patch };
    setParams(next);
    const search = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(next)) {
      if (value === defaults[key]) search.delete(key);
      else search.set(key, value);
    }
    const query = search.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }

  return [params, update];
}
