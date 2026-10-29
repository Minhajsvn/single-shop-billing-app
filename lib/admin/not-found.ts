// SERVER ONLY. Never import this from a client component (the `server-only` package is not installed).

/**
 * The single 404 that every /api/v1 path answers when it has nothing for the caller: unknown
 * paths (via app/api/v1/[[...path]]/route.ts), admin routes called by non-staff, and admin routes
 * called with a method they do not support. Keeping them byte-identical means the admin API
 * cannot be told apart from a missing route.
 */
export function adminNotFound(): Response {
  return Response.json({ error: "Not found" }, { status: 404 });
}

/**
 * Every method Next.js would otherwise answer on its own for a route file: 405 for a missing
 * method, or an automatic OPTIONS/HEAD. An admin route file must export each one it does not
 * implement as `adminNotFound`, for example:
 *
 *   export const POST = adminNotFound;
 *   export const PUT = adminNotFound;
 *   export const PATCH = adminNotFound;
 *   export const DELETE = adminNotFound;
 *   export const OPTIONS = adminNotFound;
 *
 * HEAD may be left out only when GET is implemented (Next derives HEAD from GET).
 */
export const ADMIN_ROUTE_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
