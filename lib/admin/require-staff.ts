// SERVER ONLY. Never import this from a client component (the `server-only` package is not installed).
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isStaff } from "@/lib/admin/staff";

export type StaffCheck = { ok: true; userId: string; email: string } | { ok: false };

/** Verifies the signed-in user against the auth server and the staff allowlist. Callers answer 404 on `ok: false`. */
export async function requireStaff(): Promise<StaffCheck> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user || !isStaff(user)) return { ok: false };
    return { ok: true, userId: user.id, email: user.email!.trim().toLowerCase() };
  } catch {
    return { ok: false };
  }
}

/**
 * Admin route pattern (Tasks 3–5 copy app/api/v1/admin/ping/route.ts):
 * - each implemented handler starts with `if (!(await requireStaff()).ok) return adminNotFound();`
 * - every method in ADMIN_ROUTE_METHODS the file does not implement is exported as `adminNotFound`,
 *   so no 405 or automatic OPTIONS reveals the route (HEAD may be left out when GET exists).
 * The response is identical to the catch-all app/api/v1/[...path]/route.ts for unknown paths.
 */
export { ADMIN_ROUTE_METHODS, adminNotFound } from "@/lib/admin/not-found";
