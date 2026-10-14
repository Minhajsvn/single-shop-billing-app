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

export function routeDecision({ signedIn, pathname, sampleCookie, authUnavailable = false, hasSessionCookie = false }: RouteInput): RouteDecision {
  const isLogin = pathname === "/login";
  if (signedIn) return isLogin ? "overview" : "allow";
  if (isLogin || sampleCookie === "sample") return "allow";
  // During an outage a till keeps selling offline; APIs and RLS still verify the user before any data moves.
  if (authUnavailable && hasSessionCookie) return "allow";
  return "login";
}
