import { adminErrorMessage, parsePasswordReset, refusalMessage } from "@/lib/admin/actions";
import { adminNotFound, requireStaff } from "@/lib/admin/require-staff";
import { readBody, refused } from "@/lib/admin/action-route";
import { memberInShop, sendPasswordReset } from "@/lib/admin/members";
import { isShopId } from "@/lib/admin/shop-view";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string; memberId: string }> };

/** Email the member a password-reset link: `{ note }`. Staff never see the link or a password. */
export async function POST(request: Request, { params }: Context) {
  const staff = await requireStaff();
  if (!staff.ok) return adminNotFound();
  const { id, memberId } = await params;
  if (!isShopId(id) || !isShopId(memberId)) return adminNotFound();

  const parsed = parsePasswordReset(await readBody(request));
  if (!parsed.ok) return refused(parsed.error);

  const admin = createAdminClient();
  if (!(await memberInShop(admin, memberId, id))) return refused(adminErrorMessage("member_not_found"));

  const result = await sendPasswordReset(admin, { memberId, actor: staff.userId, note: parsed.note });
  if (!result.ok) {
    const known = refusalMessage({ code: "P0001", message: result.code }).known;
    if (!known) console.error("admin password_reset failed", result.code);
    return Response.json({ error: adminErrorMessage(result.code) }, { status: known ? 400 : 500 });
  }
  return Response.json({ ok: true });
}

// Unsupported methods answer the same 404 as a missing route instead of the framework 405 / automatic OPTIONS.
export const GET = adminNotFound;
export const HEAD = adminNotFound;
export const PUT = adminNotFound;
export const PATCH = adminNotFound;
export const DELETE = adminNotFound;
export const OPTIONS = adminNotFound;
