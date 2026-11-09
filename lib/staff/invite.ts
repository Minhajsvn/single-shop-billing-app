// SERVER ONLY. Inviting staff: the service-role client looks the email up and sends the invite (Supabase Auth needs
// it); the member row is then added through the owner's own session, so staff_add_member checks the owner and logs
// them as the actor. Clients are parameters so tests can pass fakes.

type RpcResult = { data?: unknown; error?: { code?: string; message?: string } | null };
type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult> };
export type InviteResult = { userId: string } | { error: string };

function codeOf(error: { code?: string; message?: string }): string {
  return error.code === "P0001" && error.message ? error.message : "rpc_failed";
}

export async function inviteStaff(
  user: RpcClient,
  admin: RpcClient,
  input: { businessId: string; email: string; displayName: string; role: "cashier" | "manager" },
  deps: { invite: (email: string) => Promise<InviteResult> },
): Promise<{ ok: true; memberId: string; invited: boolean } | { ok: false; code: string }> {
  const lookup = await admin.rpc("admin_member_lookup", { p_business_id: input.businessId, p_email: input.email });
  if (lookup.error) return { ok: false, code: codeOf(lookup.error) };
  let userId = (lookup.data as { userId?: string | null } | null)?.userId ?? null;

  let invited = false;
  if (!userId) {
    const sent = await deps.invite(input.email);
    if ("error" in sent) {
      console.error("staff invite failed", sent.error);
      return { ok: false, code: "invite_failed" };
    }
    userId = sent.userId;
    invited = true;
  }

  const added = await user.rpc("staff_add_member", { p_business_id: input.businessId, p_user_id: userId, p_role: input.role, p_display_name: input.displayName });
  if (added.error) return { ok: false, code: codeOf(added.error) };
  return { ok: true, memberId: added.data as string, invited };
}
