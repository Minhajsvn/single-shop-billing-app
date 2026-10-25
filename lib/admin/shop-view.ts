// Pure formatting for the admin shop list and shop page. Safe to import anywhere.
import { billingSummary } from "../billing/lifecycle-view.ts";
import type { Entitlements } from "../billing/entitlements.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The shop's status in plain words; the same line the owner sees on the Billing tab. */
export function shopStatusText(e: Entitlements, now: Date): string {
  return billingSummary(e, now);
}

/** "2 of 3 allowed", or "2 (no limit)" when the effective limit is unlimited. */
export function tillsLine(active: number, allowed: number | null): string {
  return allowed === null ? `${active} (no limit)` : `${active} of ${allowed} allowed`;
}

export function isShopId(value: string): boolean {
  return UUID.test(value);
}

/**
 * A PostgREST `or` filter for the shop search: name or TRN contains the term, the owner is one of `ownerIds`
 * (matched by email elsewhere), or the term is exactly the shop id. Values are double-quoted so commas and
 * brackets in the term cannot change the filter; quotes, backslashes and wildcards are dropped from the term.
 * Null when nothing is left to search for.
 */
export function searchFilter(query: string, ownerIds: string[]): string | null {
  const term = query.replace(/[%*"\\]/g, "").trim();
  if (!term) return null;
  const parts = [`legal_name.ilike."%${term}%"`, `trn.ilike."%${term}%"`];
  if (ownerIds.length) parts.push(`owner_id.in.(${ownerIds.join(",")})`);
  if (isShopId(term)) parts.push(`id.eq.${term}`);
  return parts.join(",");
}

/** An override counts while it has no expiry or its expiry is still ahead (same rule as entitlements_internal). */
export function overrideActive(expiresAt: string | null, now: Date): boolean {
  if (expiresAt === null) return true;
  const end = new Date(expiresAt).getTime();
  return Number.isFinite(end) && end > now.getTime();
}

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dubai", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/** Dubai date and time, e.g. "19 Oct 2026, 14:00"; a dash when there is none. */
export function adminDateTime(iso: string | null): string {
  const date = iso ? new Date(iso) : null;
  if (!date || !Number.isFinite(date.getTime())) return "—";
  return DATE_TIME.format(date);
}
