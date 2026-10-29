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

/** The search term, cleaned once for every lookup: quotes, backslashes and wildcards dropped, trimmed, at most 200 chars. */
export function searchTerm(query: string): string {
  return query.replace(/[%*"\\]/g, "").trim().slice(0, 200).trim();
}

/** Lower-cased needle for the owner-email lookup; null below 3 characters, where almost every email would match. */
export function emailNeedle(term: string): string | null {
  return term.length >= 3 ? term.toLowerCase() : null;
}

/** At most this many owner ids go into `owner_id.in.(…)`, so the request URL stays short. */
export const OWNER_ID_CAP = 200;

/** Email-matched user ids that own a shop, without repeats, capped at OWNER_ID_CAP. */
export function matchingOwnerIds(userIds: string[], shopOwners: Set<string>): string[] {
  return [...new Set(userIds)].filter((id) => shopOwners.has(id)).slice(0, OWNER_ID_CAP);
}

/** Clamps a requested page (from 1) into the pages that exist, so a page past the end shows the last page. */
export function pageWindow(requested: number, total: number, size: number): { page: number; pages: number; from: number } {
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(pages, Math.max(1, Math.floor(requested) || 1));
  return { page, pages, from: (page - 1) * size };
}

/**
 * A PostgREST `or` filter for the shop search: name or TRN contains the term, the owner is one of `ownerIds`
 * (matched by email elsewhere), or the term is exactly the shop id. Values are double-quoted so commas and
 * brackets in the term cannot change the filter; the term is cleaned with searchTerm (idempotent).
 * Null when nothing is left to search for.
 */
export function searchFilter(query: string, ownerIds: string[]): string | null {
  const term = searchTerm(query);
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

const GRANT_SOON_MS = 7 * 24 * 60 * 60 * 1000;

/** A grant with an end date within the next 7 days; open-ended grants never are. */
export function grantEndingSoon(endsAt: string | null, now: Date): boolean {
  if (endsAt === null) return false;
  const end = new Date(endsAt).getTime();
  return Number.isFinite(end) && end - now.getTime() <= GRANT_SOON_MS;
}

/** Owner first, then oldest first. Returns a new array. */
export function sortMembers<T extends { isOwner: boolean; createdAt: string }>(members: T[]): T[] {
  return [...members].sort((a, b) =>
    Number(b.isOwner) - Number(a.isOwner) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}
