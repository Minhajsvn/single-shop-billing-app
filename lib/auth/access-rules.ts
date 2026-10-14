/** Set by the "Try the sample shop" button; lets a signed-out visitor use browser-only demo data. */
export const SAMPLE_MODE_COOKIE = "shop-ledger-mode";

export type RouteDecision = "allow" | "login" | "overview";

export function routeDecision({ signedIn, pathname, sampleCookie }: { signedIn: boolean; pathname: string; sampleCookie: string | undefined }): RouteDecision {
  const isLogin = pathname === "/login";
  if (signedIn) return isLogin ? "overview" : "allow";
  if (isLogin || sampleCookie === "sample") return "allow";
  return "login";
}
