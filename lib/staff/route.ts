// SERVER ONLY. Shared plumbing for /api/v1/staff routes: the signed-in member's shop, and rpc errors as responses.
// The SQL functions decide who may do what (owner, or a member setting their own PIN); this only finds the shop.
import { activeMembership } from "@/lib/access/membership";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isKnownStaffCode, staffErrorMessage } from "./actions.ts";

export const MEMBER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Session = { supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>; userId: string; businessId: string; role: string };

export async function staffSession(): Promise<{ ok: true; session: Session } | { ok: false; response: Response }> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: Response.json({ error: "Sign in first." }, { status: 401 }) };
  const { data: membership, error } = await activeMembership(supabase, user.id);
  if (error) return { ok: false, response: Response.json({ error: "Your shop could not be loaded." }, { status: 502 }) };
  if (!membership) return { ok: false, response: Response.json({ error: "No shop is set up for this account." }, { status: 404 }) };
  return { ok: true, session: { supabase, userId: user.id, businessId: membership.business_id as string, role: membership.role as string } };
}

export async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}

export function refuse(code: string, status = 400): Response {
  return Response.json({ error: staffErrorMessage(code), code }, { status });
}

/** An rpc error as a response: our refusal codes in plain words (400), anything else logged (500). */
export function rpcFailure(action: string, error: { code?: string; message?: string }): Response {
  const code = error.code === "P0001" && error.message ? error.message : "rpc_failed";
  if (!isKnownStaffCode(code)) console.error(`staff ${action} failed`, error.code, error.message);
  return refuse(code, isKnownStaffCode(code) ? (code === "not_owner" ? 403 : 400) : 500);
}
