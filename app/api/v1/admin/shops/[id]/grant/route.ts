import { adminNotFound, requireStaff } from "@/lib/admin/require-staff";
import { parseGrantPlan, parseRevokeGrant } from "@/lib/admin/actions";
import { readBody, refused, rpcFailure } from "@/lib/admin/action-route";
import { isShopId } from "@/lib/admin/shop-view";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

/** Grant a plan: `{ planId, until, note }`; no `until` means until revoked. */
export async function POST(request: Request, { params }: Context) {
  const staff = await requireStaff();
  if (!staff.ok) return adminNotFound();
  const { id } = await params;
  if (!isShopId(id)) return adminNotFound();

  const parsed = parseGrantPlan(await readBody(request), new Date());
  if (!parsed.ok) return refused(parsed.error);

  const { data, error } = await createAdminClient().rpc("admin_grant_plan", {
    p_business_id: id, p_plan_id: parsed.planId, p_ends_at: parsed.until, p_actor: staff.userId, p_note: parsed.note,
  });
  if (error) return rpcFailure("grant_plan", error);
  return Response.json({ ok: true, id: data, planId: parsed.planId, until: parsed.until });
}

/** Revoke the active grant: `{ note }`. */
export async function DELETE(request: Request, { params }: Context) {
  const staff = await requireStaff();
  if (!staff.ok) return adminNotFound();
  const { id } = await params;
  if (!isShopId(id)) return adminNotFound();

  const parsed = parseRevokeGrant(await readBody(request));
  if (!parsed.ok) return refused(parsed.error);

  const { error } = await createAdminClient().rpc("admin_revoke_grant", {
    p_business_id: id, p_actor: staff.userId, p_note: parsed.note,
  });
  if (error) return rpcFailure("revoke_grant", error);
  return Response.json({ ok: true });
}

// Unsupported methods answer the same 404 as a missing route instead of the framework 405 / automatic OPTIONS.
export const GET = adminNotFound;
export const HEAD = adminNotFound;
export const PUT = adminNotFound;
export const PATCH = adminNotFound;
export const OPTIONS = adminNotFound;
