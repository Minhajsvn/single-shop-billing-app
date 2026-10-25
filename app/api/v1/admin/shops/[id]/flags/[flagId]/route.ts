import { adminNotFound, requireStaff } from "@/lib/admin/require-staff";
import { parseFlagSeen } from "@/lib/admin/actions";
import { readBody, refused, rpcFailure } from "@/lib/admin/action-route";
import { isShopId } from "@/lib/admin/shop-view";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Mark a billing flag as looked at: `{ note }`. The actor is always the signed-in staff user. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; flagId: string }> }) {
  const staff = await requireStaff();
  if (!staff.ok) return adminNotFound();
  const { id, flagId } = await params;
  if (!isShopId(id) || !isShopId(flagId)) return adminNotFound();

  const parsed = parseFlagSeen(await readBody(request));
  if (!parsed.ok) return refused(parsed.error);

  const admin = createAdminClient();
  // The flag must belong to the shop in the URL.
  const { data: flag, error: readError } = await admin.from("admin_billing_flags").select("id")
    .eq("id", flagId).eq("business_id", id).maybeSingle();
  if (readError) return rpcFailure("flag_seen", readError);
  if (!flag) return refused("This flag no longer exists.");

  const { error } = await admin.rpc("admin_mark_flag_seen", { p_flag_id: flagId, p_actor: staff.userId, p_note: parsed.note });
  if (error) return rpcFailure("flag_seen", error);
  return Response.json({ ok: true });
}

// Unsupported methods answer the same 404 as a missing route instead of Next's 405 / automatic OPTIONS.
export const GET = adminNotFound;
export const HEAD = adminNotFound;
export const PUT = adminNotFound;
export const PATCH = adminNotFound;
export const DELETE = adminNotFound;
export const OPTIONS = adminNotFound;
