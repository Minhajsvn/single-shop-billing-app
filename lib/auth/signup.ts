export const PASSWORD_RULE = "Use at least 8 characters.";
export const NETWORK_ERROR = "Could not reach the server. Try again.";
export const RATE_LIMITED = "Too many emails were sent just now. Wait a minute and try again.";
export const CONFIRM_FAILED = "This link has expired or was already used. Sign in or ask for a new link.";
/** Seconds the "Send the link again" button stays disabled after each send. */
export const RESEND_COOLDOWN_SECONDS = 60;

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SignupInput = { name: string; email: string; password: string };
export type AuthErrorLike = { message?: string; status?: number; code?: string; name?: string } | null;
export type ConfirmType = "signup" | "recovery" | "email" | "invite";

export const INVALID_EMAIL = "Enter a valid email address.";

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

export function validateSignup({ name, email, password }: SignupInput): string | null {
  if (!name.trim()) return "Enter your name.";
  if (!isValidEmail(email)) return INVALID_EMAIL;
  if (password.length < MIN_PASSWORD_LENGTH) return PASSWORD_RULE;
  return null;
}

export function isNetworkError(error: AuthErrorLike): boolean {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  if (error.name === "AuthRetryableFetchError") return true;
  if (error.status === 0 || (error.status ?? 0) >= 500) return true;
  return message.includes("fetch") || message.includes("network");
}

/** Plain-words copy for a sign-up error; null means "show the check-email screen". */
export function signupErrorMessage(error: AuthErrorLike): string | null {
  if (!error) return null;
  if (isNetworkError(error)) return NETWORK_ERROR;
  if (error.status === 429) return RATE_LIMITED;
  const message = (error.message ?? "").toLowerCase();
  // Never reveal that an address already has an account.
  if (error.code === "user_already_exists" || message.includes("already registered") || message.includes("already been registered")) return null;
  if (error.code === "weak_password" || message.includes("password")) return PASSWORD_RULE;
  return error.message || NETWORK_ERROR;
}

export function isEmailNotConfirmed(error: AuthErrorLike): boolean {
  if (!error) return false;
  return error.code === "email_not_confirmed" || (error.message ?? "").toLowerCase().includes("email not confirmed");
}

const SAFE_BASE = "http://next.invalid";

/**
 * A same-origin path only: "/x" yes; "//x", backslashes, control characters, spaces and absolute URLs no.
 * Browsers strip tabs and newlines from a Location header, so "/\t/evil.com" would become "//evil.com".
 */
export function safeNext(next: string | null | undefined, fallback: string): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\x00-\x20\x7f\\]/.test(next)) return fallback;
  let resolved: URL;
  try {
    resolved = new URL(next, SAFE_BASE);
  } catch {
    return fallback;
  }
  if (resolved.origin !== SAFE_BASE) return fallback;
  // Dot segments can collapse "/.//evil.com" into "//evil.com", which a browser reads as another site.
  if (resolved.pathname.startsWith("//") || /\/\.{0,2}\/|%2e/i.test(next.split(/[?#]/)[0])) return fallback;
  return resolved.pathname + resolved.search + resolved.hash;
}

const DEFAULT_NEXT: Record<ConfirmType, string> = { signup: "/setup", recovery: "/reset-password", email: "/overview", invite: "/reset-password" };

export function confirmParams(url: URL): { tokenHash: string; type: ConfirmType; next: string } | null {
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  if (!tokenHash) return null;
  if (type !== "signup" && type !== "recovery" && type !== "email" && type !== "invite") return null;
  return { tokenHash, type, next: safeNext(url.searchParams.get("next"), DEFAULT_NEXT[type]) };
}
