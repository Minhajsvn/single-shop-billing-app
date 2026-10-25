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

/** The admin console answers 404 to anyone who is not staff, so the proxy must not reveal it with a login redirect. */
function isAdminPath(pathname: string) {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function routeDecision({ signedIn, pathname, sampleCookie, authUnavailable = false, hasSessionCookie = false }: RouteInput): RouteDecision {
  if (isAdminPath(pathname)) return "allow";
  if (signedIn) return SIGNED_OUT_ONLY.has(pathname) ? "overview" : "allow";
  if (PUBLIC_PATHS.has(pathname) || sampleCookie === "sample") return "allow";
  // During an outage a till keeps selling offline; APIs and RLS still verify the user before any data moves.
  if (authUnavailable && hasSessionCookie) return "allow";
  return "login";
}
