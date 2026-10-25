import { adminNotFound, requireStaff } from "@/lib/admin/require-staff";
import { parseExtendTrial } from "@/lib/admin/actions";
import { readBody, refused, rpcFailure } from "@/lib/admin/action-route";
import { isShopId } from "@/lib/admin/shop-view";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Extend a trial: `{ days: 7 | 14, note }` or `{ until, note }`. The actor is always the signed-in staff user. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff.ok) return adminNotFound();
  const { id } = await params;
  if (!isShopId(id)) return adminNotFound();

  const admin = createAdminClient();
  const { data: sub, error: readError } = await admin.from("subscriptions").select("trial_ends_at").eq("business_id", id).maybeSingle();
  if (readError) return rpcFailure("extend_trial", readError);

  const parsed = parseExtendTrial(await readBody(request), new Date(), sub?.trial_ends_at ?? null);
  if (!parsed.ok) return refused(parsed.error);

  const { error } = await admin.rpc("admin_extend_trial", {
    p_business_id: id, p_trial_ends_at: parsed.until, p_actor: staff.userId, p_note: parsed.note,
  });
  if (error) return rpcFailure("extend_trial", error);
  return Response.json({ ok: true, trialEndsAt: parsed.until });
}

// Unsupported methods answer the same 404 as a missing route instead of Next's 405 / automatic OPTIONS.
export const GET = adminNotFound;
export const HEAD = adminNotFound;
export const PUT = adminNotFound;
export const PATCH = adminNotFound;
export const DELETE = adminNotFound;
export const OPTIONS = adminNotFound;
