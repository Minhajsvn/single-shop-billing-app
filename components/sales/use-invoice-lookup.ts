"use client";

import { useEffect, useState } from "react";
import type { InvoiceLookup } from "@/lib/sales/invoice-lookup";

export const INVOICE_NOT_FOUND = "No sale with that invoice number.";
const UNREACHABLE = "Could not reach the server. Try again.";

// Sales found by invoice number in this page visit, by sale id, so opening the refund view does not look it up twice.
const found = new Map<string, InvoiceLookup>();

/** Looks up one sale of this shop by its exact invoice number (member-only; audited on the server). */
export async function lookupInvoice(invoice: string): Promise<{ ok: true; lookup: InvoiceLookup } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/sales/by-invoice?invoice=${encodeURIComponent(invoice.trim())}`, { cache: "no-store" });
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
  const body = await response.json().catch(() => null) as (InvoiceLookup & { error?: string }) | null;
  if (response.status === 404) return { ok: false, error: INVOICE_NOT_FOUND };
  if (!response.ok || !body?.sale) return { ok: false, error: body?.error ?? "The sale could not be loaded." };
  const lookup = { sale: body.sale, creditNotes: body.creditNotes ?? [] };
  found.set(lookup.sale.id, lookup);
  return { ok: true, lookup };
}

export type FoundSale = { status: "idle" | "loading" | "loaded" | "missing" | "error"; lookup: InvoiceLookup | null };

/**
 * The sale behind /sales/<id>?invoice=<number> for a member who found it by invoice number: from this visit's
 * lookup, or looked up again (a reload) when online.
 */
export function useFoundSale(id: string, enabled: boolean, online: boolean): FoundSale {
  const [result, setResult] = useState<FoundSale>({ status: "idle", lookup: null });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const cached = found.get(id);
      if (cached) return setResult({ status: "loaded", lookup: cached });
      const invoice = new URLSearchParams(window.location.search).get("invoice")?.trim();
      if (!invoice || !online) return setResult({ status: "missing", lookup: null });
      setResult({ status: "loading", lookup: null });
      void lookupInvoice(invoice).then((answer) => {
        if (cancelled) return;
        if (answer.ok && answer.lookup.sale.id === id) setResult({ status: "loaded", lookup: answer.lookup });
        else setResult({ status: answer.ok || answer.error === INVOICE_NOT_FOUND ? "missing" : "error", lookup: null });
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, id, online]);

  return enabled ? result : { status: "idle", lookup: null };
}
