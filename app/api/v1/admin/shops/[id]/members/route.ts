import { adminErrorMessage, parseAddMember, refusalMessage } from "@/lib/admin/actions";
import { adminNotFound, requireStaff } from "@/lib/admin/require-staff";
import { readBody, refused } from "@/lib/admin/action-route";
import { addMember } from "@/lib/admin/members";
import { isShopId } from "@/lib/admin/shop-view";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

/** Add a member: `{ email, role, note }`. An email with no account is invited and asked to set a password. */
export async function POST(request: Request, { params }: Context) {
  const staff = await requireStaff();
  if (!staff.ok) return adminNotFound();
  const { id } = await params;
  if (!isShopId(id)) return adminNotFound();

  const parsed = parseAddMember(await readBody(request));
  if (!parsed.ok) return refused(parsed.error);

  const result = await addMember(
    createAdminClient() as unknown as Parameters<typeof addMember>[0],
    { businessId: id, email: parsed.email, role: parsed.role, actor: staff.userId, note: parsed.note },
    { redirectTo: `${new URL(request.url).origin}/auth/confirm?next=/reset-password` },
  );
  if (!result.ok) {
    const known = refusalMessage({ code: "P0001", message: result.code }).known;
    if (!known) console.error("admin add_member failed", result.code);
    return Response.json({ error: adminErrorMessage(result.code) }, { status: known ? 400 : 500 });
  }
  return Response.json({ ok: true, id: result.memberId, invited: result.invited });
}

// Unsupported methods answer the same 404 as a missing route instead of the framework 405 / automatic OPTIONS.
export const GET = adminNotFound;
export const HEAD = adminNotFound;
export const PUT = adminNotFound;
export const PATCH = adminNotFound;
export const DELETE = adminNotFound;
export const OPTIONS = adminNotFound;
