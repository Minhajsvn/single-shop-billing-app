// SERVER ONLY: every route that needs "the signed-in user's shop" resolves it here, so all routes agree.
import type { createServerSupabaseClient } from "@/lib/supabase/server";
import type { MemberRole } from "@/lib/snapshot/types";
import { chooseMembership } from "@/lib/access/choose-membership";

type ServerClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

export type ActiveMembership = { business_id: string; role: MemberRole; status: "active"; created_at: string };

/** The user's active membership (highest role, then oldest), or null when they belong to no shop. */
export async function activeMembership(supabase: ServerClient, userId: string): Promise<{ data: ActiveMembership | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("business_members")
    .select("business_id, role, status, created_at")
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) return { data: null, error };
  return { data: chooseMembership((data ?? []) as ActiveMembership[]), error: null };
}
