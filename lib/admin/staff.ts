import { createHash, timingSafeEqual } from "node:crypto";

type Env = Record<string, string | undefined>;

type StaffCandidate = { email?: string | null; email_confirmed_at?: string | null } | null;

/** Minimum length of ADMIN_CRON_SECRET; a shorter (or missing) secret disables the cron path. */
export const MIN_CRON_SECRET_LENGTH = 32;

/** Header the daily billing check sends instead of a staff session. */
export const CRON_SECRET_HEADER = "x-admin-cron-secret";

/** Comma-separated allowlist, trimmed and lower-cased; blanks are dropped. */
export function parseStaffEmails(raw: string | undefined): Set<string> {
  const emails = new Set<string>();
  for (const part of (raw ?? "").split(",")) {
    const email = part.trim().toLowerCase();
    if (email) emails.add(email);
  }
  return emails;
}

/** Staff = confirmed email on the PLATFORM_STAFF_EMAILS allowlist. A missing allowlist names nobody. */
export function isStaff(user: StaffCandidate, env: Env = process.env): boolean {
  if (!user?.email || !user.email_confirmed_at) return false;
  return parseStaffEmails(env.PLATFORM_STAFF_EMAILS).has(user.email.trim().toLowerCase());
}

/** Constant-time check of the cron header against ADMIN_CRON_SECRET (false when the secret is missing or too short). */
export function cronSecretMatches(header: string | null, env: Env = process.env): boolean {
  const secret = env.ADMIN_CRON_SECRET ?? "";
  if (secret.length < MIN_CRON_SECRET_LENGTH || !header) return false;
  // Hashing first gives equal-length buffers, so timingSafeEqual never leaks the secret's length.
  const expected = createHash("sha256").update(secret).digest();
  const actual = createHash("sha256").update(header).digest();
  return timingSafeEqual(expected, actual);
}
