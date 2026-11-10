import { adminNotFound, requireStaff } from "@/lib/admin/require-staff";
import { parseRevokeFounder } from "@/lib/admin/actions";
import { readBody, refused, rpcFailure } from "@/lib/admin/action-route";
import { isShopId } from "@/lib/admin/shop-view";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

/** Take back the shop's Founding 50 seat: `{ note }`. The seat is freed for the next shop that pays. */
export async function DELETE(request: Request, { params }: Context) {
  const staff = await requireStaff();
  if (!staff.ok) return adminNotFound();
  const { id } = await params;
  if (!isShopId(id)) return adminNotFound();

  const parsed = parseRevokeFounder(await readBody(request));
  if (!parsed.ok) return refused(parsed.error);

  const { error } = await createAdminClient().rpc("admin_revoke_founding_seat", {
    p_business: id, p_actor: staff.userId, p_note: parsed.note,
  });
  if (error) return rpcFailure("revoke_founding_seat", error);
  return Response.json({ ok: true });
}

// Unsupported methods answer the same 404 as a missing route instead of the framework 405 / automatic OPTIONS.
export const GET = adminNotFound;
export const HEAD = adminNotFound;
export const POST = adminNotFound;
export const PUT = adminNotFound;
export const PATCH = adminNotFound;
export const OPTIONS = adminNotFound;
