import { adminNotFound, requireStaff } from "@/lib/admin/require-staff";
import { parseEndExtraTill, parseExtraTill } from "@/lib/admin/actions";
import { readBody, refused, rpcFailure } from "@/lib/admin/action-route";
import { isShopId } from "@/lib/admin/shop-view";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

/** Give an extra till: `{ until, note }`. An active extra till is ended first (in SQL). */
export async function POST(request: Request, { params }: Context) {
  const staff = await requireStaff();
  if (!staff.ok) return adminNotFound();
  const { id } = await params;
  if (!isShopId(id)) return adminNotFound();

  const parsed = parseExtraTill(await readBody(request), new Date());
  if (!parsed.ok) return refused(parsed.error);

  const { data, error } = await createAdminClient().rpc("admin_give_extra_till", {
    p_business_id: id, p_until: parsed.until, p_actor: staff.userId, p_note: parsed.note,
  });
  if (error) return rpcFailure("give_extra_till", error);
  return Response.json({ ok: true, id: data, until: parsed.until });
}

/** End the active extra till now: `{ note }`. */
export async function DELETE(request: Request, { params }: Context) {
  const staff = await requireStaff();
  if (!staff.ok) return adminNotFound();
  const { id } = await params;
  if (!isShopId(id)) return adminNotFound();

  const parsed = parseEndExtraTill(await readBody(request));
  if (!parsed.ok) return refused(parsed.error);

  const { error } = await createAdminClient().rpc("admin_end_extra_till", {
    p_business_id: id, p_actor: staff.userId, p_note: parsed.note,
  });
  if (error) return rpcFailure("end_extra_till", error);
  return Response.json({ ok: true });
}

// Unsupported methods answer the same 404 as a missing route instead of Next's 405 / automatic OPTIONS.
export const GET = adminNotFound;
export const HEAD = adminNotFound;
export const PUT = adminNotFound;
export const PATCH = adminNotFound;
export const OPTIONS = adminNotFound;
