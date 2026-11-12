import { readJson, staffSession } from "@/lib/staff/route";
import { normalizeScaleLabel } from "@/lib/weighing/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KNOWN = new Set(["invalid_scale_label", "feature_not_in_plan", "not_owner"]);

/** Stage 2F: the shop's scale label layout `{ prefixes, codeLength, value }`. Owner only, Pro; the database checks both. */
export async function PUT(request: Request) {
  const auth = await staffSession();
  if (!auth.ok) return auth.response;
  const { supabase, businessId } = auth.session;

  const body = await readJson(request);
  const settings = normalizeScaleLabel(body);
  // normalizeScaleLabel falls back to the default for anything invalid: refuse instead of saving the default.
  if (JSON.stringify(settings) !== JSON.stringify(body)) return Response.json({ code: "invalid_scale_label" }, { status: 400 });

  const { error } = await supabase.rpc("shop_set_scale_label", { p_business_id: businessId, p_settings: settings });
  if (error) {
    const code = error.code === "P0001" && error.message ? error.message : "rpc_failed";
    if (!KNOWN.has(code)) console.error("scale label save failed", error.code, error.message);
    return Response.json({ code }, { status: code === "not_owner" ? 403 : KNOWN.has(code) ? 400 : 500 });
  }
  return Response.json({ ok: true });
}
