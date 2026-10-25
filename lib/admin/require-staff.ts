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

/** The 404 every admin route answers to non-staff, so the console's existence is not revealed. */
export function adminNotFound() {
  return Response.json({ error: "Not found" }, { status: 404 });
}
