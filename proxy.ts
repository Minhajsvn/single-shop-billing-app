import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SAMPLE_MODE_COOKIE, routeDecision } from "@/lib/auth/access-rules";

function isConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );
}

export async function proxy(request: NextRequest) {
  if (!isConfigured()) return NextResponse.next();

  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user }, error } = await supabase.auth.getUser();
  // A network failure or 5xx means the auth server is unreachable, not that the user signed out.
  const authUnavailable = Boolean(error && (error.name === "AuthRetryableFetchError" || error.status === 0 || (error.status ?? 0) >= 500));
  const decision = routeDecision({
    signedIn: Boolean(user),
    pathname: request.nextUrl.pathname,
    sampleCookie: request.cookies.get(SAMPLE_MODE_COOKIE)?.value,
    authUnavailable,
    hasSessionCookie: request.cookies.getAll().some((cookie) => cookie.name.startsWith("sb-") && cookie.name.includes("-auth-token")),
  });

  if (decision === "login") {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (decision === "overview") {
    const overviewUrl = request.nextUrl.clone();
    overviewUrl.pathname = "/overview";
    overviewUrl.search = "";
    return NextResponse.redirect(overviewUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icon.svg).*)",
  ],
};
