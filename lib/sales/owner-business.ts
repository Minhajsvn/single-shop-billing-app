import { createServerSupabaseClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

/** The signed-in user's business, for server sales routes. The RPCs check ownership again. */
export async function ownerBusiness(): Promise<{ ok: true; supabase: ServerClient; businessId: string } | { ok: false; status: number; error: string }> {
  let supabase: ServerClient;
  try {
    supabase = await createServerSupabaseClient();
  } catch {
    return { ok: false, status: 503, error: "Hosted search is not configured." };
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: "Authentication is required." };
  const { data: membership, error } = await supabase.from("business_members").select("business_id").eq("user_id", user.id).eq("status", "active").limit(1).maybeSingle();
  if (error) return { ok: false, status: 502, error: error.message };
  if (!membership) return { ok: false, status: 404, error: "No business is configured for this account." };
  return { ok: true, supabase, businessId: membership.business_id as string };
}
