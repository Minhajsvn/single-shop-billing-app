// Stage 2C: margin and report-period helpers shared by the products page and the Profit tab.
import type { TaxCategory } from "../fiscal/countries.ts";
import { calculateVatInclusive } from "../domain.ts";
import { uaeBusinessDate } from "../reporting.ts";

/** The Profit tab reads at most this many days back (the snapshot's history window). */
export const MAX_HISTORY_DAYS = 90;

export type PeriodKey = "today" | "yesterday" | "this-week" | "this-month" | "last-month";

/**
 * The price excl. VAT that a sale of this product records. Checkout charges standard VAT on every product today
 * (Stage 1D stores the VAT category only), so the category does not change the result yet; it is taken so callers
 * need not change when per-category VAT ships.
 */
export function priceExVatFils(priceFils: number, _taxCategory: TaxCategory): number {
  return calculateVatInclusive(priceFils).netFils;
}

/** Profit as a share of net sales, one decimal; null when there are no net sales. */
export function marginPct(netFils: number, costFils: number): number | null {
  if (netFils <= 0) return null;
  return Math.round(((netFils - costFils) * 1000) / netFils) / 10;
}

export function isBelowCost(product: { priceFils: number; taxCategory: TaxCategory }, costFils: number | null | undefined): boolean {
  return costFils !== null && costFils !== undefined && priceExVatFils(product.priceFils, product.taxCategory) < costFils;
}

/** YYYY-MM-DD arithmetic in UTC, so the machine's own time zone never moves a date. */
function shift(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** A period as Dubai business dates, inclusive. Weeks start on Monday. */
export function periodRange(key: PeriodKey, now: Date): { from: string; to: string } {
  const today = uaeBusinessDate(now);
  const [year, month, day] = today.split("-").map(Number);
  if (key === "today") return { from: today, to: today };
  if (key === "yesterday") {
    const yesterday = shift(today, -1);
    return { from: yesterday, to: yesterday };
  }
  if (key === "this-week") {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 Sunday … 6 Saturday
    return { from: shift(today, -((weekday + 6) % 7)), to: today };
  }
  if (key === "this-month") return { from: `${today.slice(0, 7)}-01`, to: today };
  const firstThisMonth = `${today.slice(0, 7)}-01`;
  const lastPrevious = shift(firstThisMonth, -1);
  return { from: `${lastPrevious.slice(0, 7)}-01`, to: lastPrevious };
}
