// Pure parsing and copy for the admin shop actions. Safe to import anywhere (the action UI uses it for previews);
// the routes under app/api/v1/admin/shops/[id] are the authority.

export const NOTE_MAX = 500;
export const TRIAL_QUICK_DAYS = [7, 14] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MESSAGES: Record<string, string> = {
  not_trialing: "Only trials can be extended.",
  trial_has_card: "Change the trial end in Stripe.",
  end_not_in_future: "Choose a trial end in the future.",
  note_required: `Write a note of up to ${NOTE_MAX} characters.`,
  until_not_in_future: "Choose an end date in the future.",
  no_extra_till: "This shop has no extra till to end.",
  shop_not_found: "This shop no longer exists.",
  plan_has_no_till_limit: "This plan has no till limit, so an extra till is not needed.",
  flag_not_found: "This flag no longer exists.",
  flag_already_seen: "This flag was already marked looked at.",
};
const FALLBACK = "That did not work. Try again.";

/** Plain words for a refusal code raised by the admin_* SQL functions (or the parsers below). */
export function adminErrorMessage(code: string): string {
  return Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : FALLBACK;
}

/** Reads a database error from supabase.rpc: only our own P0001 refusal codes are shown; anything else is generic. */
export function refusalMessage(error: { code?: string; message?: string } | null | undefined): { known: boolean; message: string } {
  const code = error?.code === "P0001" ? error.message ?? "" : "";
  const known = Object.hasOwn(MESSAGES, code);
  return { known, message: known ? MESSAGES[code] : FALLBACK };
}

type Fail = { ok: false; error: string };
const fail = (code: string): Fail => ({ ok: false, error: adminErrorMessage(code) });

function record(body: unknown): Record<string, unknown> | null {
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

function note(raw: unknown): string | null {
  const cleaned = typeof raw === "string" ? raw.trim() : "";
  return cleaned.length >= 1 && cleaned.length <= NOTE_MAX ? cleaned : null;
}

/**
 * A full ISO date-time, or a date (YYYY-MM-DD) meaning the end of that day in Dubai (UTC+4, no daylight saving).
 * Returns epoch milliseconds, or null when it is not a real date.
 */
function parseUntil(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const day = ISO_DATE.exec(raw);
  if (day) {
    const [y, m, d] = [Number(day[1]), Number(day[2]), Number(day[3])];
    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
    return Date.UTC(y, m - 1, d, 23, 59, 59, 999) - 4 * 60 * 60 * 1000;
  }
  if (!ISO_DATE_TIME.test(raw)) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

/** `{ days: 7 | 14, note }` counts from max(now, current trial end); `{ until, note }` sets the end directly. */
export function parseExtendTrial(body: unknown, now: Date, currentEnd: string | null): { ok: true; until: string; note: string } | Fail {
  const input = record(body);
  if (!input) return fail("end_not_in_future");
  let until: number | null;
  if (input.days !== undefined) {
    if (!TRIAL_QUICK_DAYS.includes(input.days as 7 | 14)) return fail("end_not_in_future");
    const current = currentEnd ? Date.parse(currentEnd) : NaN;
    const from = Number.isFinite(current) ? Math.max(now.getTime(), current) : now.getTime();
    until = from + (input.days as number) * DAY_MS;
  } else {
    until = parseUntil(input.until);
    if (until === null || until <= now.getTime()) return fail("end_not_in_future");
  }
  const cleaned = note(input.note);
  if (cleaned === null) return fail("note_required");
  return { ok: true, until: new Date(until).toISOString(), note: cleaned };
}

/** `{ until, note }` for a new extra till; until must be in the future. */
export function parseExtraTill(body: unknown, now: Date): { ok: true; until: string; note: string } | Fail {
  const input = record(body);
  if (!input) return fail("until_not_in_future");
  const until = parseUntil(input.until);
  if (until === null || until <= now.getTime()) return fail("until_not_in_future");
  const cleaned = note(input.note);
  if (cleaned === null) return fail("note_required");
  return { ok: true, until: new Date(until).toISOString(), note: cleaned };
}

/** `{ note }` for ending the active extra till now. */
export function parseEndExtraTill(body: unknown): { ok: true; note: string } | Fail {
  const cleaned = note(record(body)?.note);
  return cleaned === null ? fail("note_required") : { ok: true, note: cleaned };
}

/** `{ note }` for marking a billing flag as looked at. */
export function parseFlagSeen(body: unknown): { ok: true; note: string } | Fail {
  return parseEndExtraTill(body);
}
