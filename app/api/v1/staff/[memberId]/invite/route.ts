import { MEMBER_ID, refuse, staffSession } from "@/lib/staff/route";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ memberId: string }> };

/** Resend the invitation (owner only). Someone who already set a password gets a password-reset email instead. */
export async function POST(request: Request, { params }: Context) {
  const { memberId } = await params;
  if (!MEMBER_ID.test(memberId)) return refuse("member_not_found", 404);
  const auth = await staffSession();
  if (!auth.ok) return auth.response;
  const { supabase, businessId, role } = auth.session;
  if (role !== "owner") return refuse("not_owner", 403);

  // staff_list confirms the member is in this owner's shop and gives the email.
  const { data, error } = await supabase.rpc("staff_list", { p_business_id: businessId });
  if (error) return refuse("not_owner", 403);
  const member = ((data ?? []) as { member_id: string; email: string | null; role: string }[]).find((m) => m.member_id === memberId);
  if (!member?.email) return refuse("member_not_found", 404);
  if (member.role === "owner") return refuse("owner_protected");

  const admin = createAdminClient();
  const redirectTo = `${new URL(request.url).origin}/auth/confirm?next=/reset-password`;
  const invited = await admin.auth.admin.inviteUserByEmail(member.email, { redirectTo });
  if (invited.error) {
    const reset = await admin.auth.resetPasswordForEmail(member.email, { redirectTo });
    if (reset.error) {
      console.error("staff resend invite failed", invited.error.message, reset.error.message);
      return refuse("invite_failed", 502);
    }
  }
  return Response.json({ ok: true });
}
