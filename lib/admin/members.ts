// SERVER ONLY. Member management for platform staff: add (inviting unknown emails) and password-reset email.
// The admin client is a parameter so tests can pass a fake. Staff never see or set a password or a link.
import type { createAdminClient } from "@/lib/supabase/admin";

type RpcError = { code?: string; message?: string } | null;
// The real service-role client. Tests pass a fake with the same few methods (types are erased there); a hand-written
// structural twin of the Supabase builders made TypeScript give up with TS2589 "excessively deep".
type AdminClientLike = ReturnType<typeof createAdminClient>;

export type MemberRole = "cashier" | "manager";
export type AddMemberResult = { ok: true; memberId: string; invited: boolean } | { ok: false; code: string };
export type InviteResult = { userId: string } | { error: string };

/** Our refusal code from an rpc error, or a generic code for anything unexpected. */
function codeOf(error: NonNullable<RpcError>): string {
  return error.code === "P0001" && error.message ? error.message : "rpc_failed";
}

/**
 * Lookup, then (no account) invite, then add. An invite error stops before any insert.
 * `deps.invite` is replaceable for tests; the default invites through Supabase Auth with `deps.redirectTo`.
 */
export async function addMember(
  admin: AdminClientLike,
  input: { businessId: string; email: string; role: MemberRole; actor: string; note: string },
  deps: { invite?: (email: string) => Promise<InviteResult>; redirectTo?: string } = {},
): Promise<AddMemberResult> {
  const lookup = await admin.rpc("admin_member_lookup", { p_business_id: input.businessId, p_email: input.email });
  if (lookup.error) return { ok: false, code: codeOf(lookup.error) };
  let userId = (lookup.data as { userId?: string | null } | null)?.userId ?? null;

  let invited = false;
  if (!userId) {
    const invite = deps.invite ?? (async (email: string): Promise<InviteResult> => {
      const { data, error } = await admin.auth.admin.inviteUserByEmail!(email, { redirectTo: deps.redirectTo });
      return error || !data.user ? { error: String((error as { message?: string } | null)?.message ?? "no user") } : { userId: data.user.id };
    });
    const result = await invite(input.email);
    if ("error" in result) {
      console.error("admin invite failed", result.error);
      return { ok: false, code: "invite_failed" };
    }
    userId = result.userId;
    invited = true;
  }

  const added = await admin.rpc("admin_add_member", {
    p_business_id: input.businessId, p_user_id: userId, p_role: input.role, p_actor: input.actor, p_note: input.note,
  });
  if (added.error) return { ok: false, code: codeOf(added.error) };
  return { ok: true, memberId: added.data as string, invited };
}

/** True only when the member row exists and belongs to this shop. */
export async function memberInShop(admin: AdminClientLike, memberId: string, businessId: string): Promise<boolean> {
  const { data } = await admin.from("business_members").select("business_id,user_id").eq("id", memberId).maybeSingle();
  return (data as { business_id?: string } | null)?.business_id === businessId;
}

/** Sends the standard recovery email to the member, then records it. A send error writes no audit row. */
export async function sendPasswordReset(
  admin: AdminClientLike,
  input: { memberId: string; actor: string; note: string },
): Promise<{ ok: true } | { ok: false; code: string }> {
  const { data } = await admin.from("business_members").select("business_id,user_id").eq("id", input.memberId).maybeSingle();
  const userId = (data as { user_id?: string } | null)?.user_id;
  if (!userId) return { ok: false, code: "member_not_found" };

  const { data: found } = await admin.auth.admin.getUserById(userId);
  const email = found.user?.email;
  if (!email) return { ok: false, code: "reset_failed" };

  const { error: sendError } = await admin.auth.resetPasswordForEmail(email);
  if (sendError) {
    console.error("admin password reset email failed", (sendError as { message?: string }).message);
    return { ok: false, code: "reset_failed" };
  }
  const logged = await admin.rpc("admin_log_password_reset", { p_member_id: input.memberId, p_actor: input.actor, p_note: input.note });
  if (logged.error) return { ok: false, code: codeOf(logged.error) };
  return { ok: true };
}
