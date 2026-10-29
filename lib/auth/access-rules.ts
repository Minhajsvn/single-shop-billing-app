/** Set by the "Try the sample shop" button; lets a signed-out visitor use browser-only demo data. */
export const SAMPLE_MODE_COOKIE = "shop-ledger-mode";

export type RouteDecision = "allow" | "login" | "overview";

type RouteInput = {
  signedIn: boolean;
  pathname: string;
  sampleCookie: string | undefined;
  /** The auth server could not be reached, so "no user" means "unknown", not "signed out". */
  authUnavailable?: boolean;
  hasSessionCookie?: boolean;
};

/** Pages a signed-in user is sent past, straight to the overview. */
const SIGNED_OUT_ONLY = new Set(["/login", "/signup"]);
/** Reachable without an account: sign-in, sign-up, password reset and the email-link callback. */
const PUBLIC_PATHS = new Set(["/login", "/signup", "/forgot-password", "/reset-password", "/auth/confirm"]);

/**
 * Where to go after signing in: the ?next= path the proxy recorded, if it is a plain path on this
 * site (no scheme, host, "//", backslash or encoded slash) and not a signed-out page; else the overview.
 */
export function safeNextPath(raw: string | string[] | undefined): string {
  if (typeof raw !== "string" || !/^\/[A-Za-z0-9\-._~/]*$/.test(raw) || raw.startsWith("//")) return "/overview";
  return SIGNED_OUT_ONLY.has(raw) ? "/overview" : raw;
}

// /admin gets no special case: signed-out visitors go to /login exactly like any unknown path,
// and signed-in non-staff get the page's own 404, so the console cannot be told apart from a missing page.
export function routeDecision({ signedIn, pathname, sampleCookie, authUnavailable = false, hasSessionCookie = false }: RouteInput): RouteDecision {
  if (signedIn) return SIGNED_OUT_ONLY.has(pathname) ? "overview" : "allow";
  if (PUBLIC_PATHS.has(pathname) || sampleCookie === "sample") return "allow";
  // During an outage a till keeps selling offline; APIs and RLS still verify the user before any data moves.
  if (authUnavailable && hasSessionCookie) return "allow";
  return "login";
}
