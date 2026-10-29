import { adminErrorMessage, parseMemberChange } from "@/lib/admin/actions";
import { adminNotFound, requireStaff } from "@/lib/admin/require-staff";
import { readBody, refused, rpcFailure } from "@/lib/admin/action-route";
import { memberInShop } from "@/lib/admin/members";
import { isShopId } from "@/lib/admin/shop-view";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string; memberId: string }> };

/** Change a member: `{ role, note }` or `{ status, note }`. The member must belong to the shop in the URL. */
export async function PATCH(request: Request, { params }: Context) {
  const staff = await requireStaff();
  if (!staff.ok) return adminNotFound();
  const { id, memberId } = await params;
  if (!isShopId(id) || !isShopId(memberId)) return adminNotFound();

  const parsed = parseMemberChange(await readBody(request));
  if (!parsed.ok) return refused(parsed.error);

  const admin = createAdminClient();
  if (!(await memberInShop(admin, memberId, id))) return refused(adminErrorMessage("member_not_found"));

  const { error } = "role" in parsed.change
    ? await admin.rpc("admin_set_member_role", { p_member_id: memberId, p_role: parsed.change.role, p_actor: staff.userId, p_note: parsed.note })
    : await admin.rpc("admin_set_member_status", { p_member_id: memberId, p_status: parsed.change.status, p_actor: staff.userId, p_note: parsed.note });
  if (error) return rpcFailure("set_member", error);
  return Response.json({ ok: true });
}

// Unsupported methods answer the same 404 as a missing route instead of the framework 405 / automatic OPTIONS.
export const GET = adminNotFound;
export const HEAD = adminNotFound;
export const POST = adminNotFound;
export const PUT = adminNotFound;
export const DELETE = adminNotFound;
export const OPTIONS = adminNotFound;
