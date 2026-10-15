import { createServerSupabaseClient } from "@/lib/supabase/server";
import { parseEntitlements } from "@/lib/billing/entitlements";
import { signEntitlements } from "@/lib/billing/entitlement-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const secret = process.env.ENTITLEMENT_SIGNING_SECRET;
  if (!secret) return Response.json({ error: "Entitlements are not configured." }, { status: 503 });
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "Authentication is required." }, { status: 401 });
    const { data: membership, error: memberError } = await supabase
      .from("business_members").select("business_id").eq("user_id", user.id).eq("status", "active").limit(1).maybeSingle();
    if (memberError) return Response.json({ error: memberError.message }, { status: 502 });
    if (!membership) return Response.json({ error: "No business is configured for this account." }, { status: 404 });
    const { data, error } = await supabase.rpc("business_entitlements", { target_business_id: membership.business_id });
    if (error) return Response.json({ error: error.message }, { status: 502 });
    const entitlements = parseEntitlements(data);
    const { token, expiresAt } = signEntitlements(entitlements, membership.business_id, secret);
    return Response.json({ businessId: membership.business_id, entitlements, token, expiresAt });
  } catch {
    return Response.json({ error: "Entitlements could not be loaded." }, { status: 503 });
  }
}
