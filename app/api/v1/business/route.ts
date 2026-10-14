import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const businessSchema = z.object({
  name: z.string().trim().min(1).max(200),
  trn: z.string().regex(/^[0-9]{15}$/),
  address: z.string().trim().min(1).max(500),
  phone: z.string().trim().min(3).max(40),
  prefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,8}$/),
  footer: z.string().trim().max(300),
});

const businessSelect = "id, legal_name, trn, address, phone, invoice_prefix, receipt_footer";

function responseError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

async function authenticatedClient() {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { supabase: null, user: null };
  return { supabase, user };
}

type ServerClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

async function memberBusinessId(supabase: ServerClient, userId: string) {
  const { data, error } = await supabase
    .from("business_members")
    .select("business_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  return { businessId: (data?.business_id as string | undefined) ?? null, error };
}

export async function GET() {
  try {
    const { supabase, user } = await authenticatedClient();
    if (!supabase || !user) return responseError("Authentication is required.", 401);

    const membership = await memberBusinessId(supabase, user.id);
    if (membership.error) return responseError(membership.error.message, 502);
    if (!membership.businessId) return responseError("No business is configured for this account.", 404);

    const { data, error } = await supabase
      .from("businesses")
      .select(businessSelect)
      .eq("id", membership.businessId)
      .maybeSingle();

    if (error) return responseError(error.message, 502);
    if (!data) return responseError("No business is configured for this account.", 404);

    return Response.json({
      business: {
        id: data.id,
        name: data.legal_name,
        trn: data.trn,
        address: data.address,
        phone: data.phone,
        prefix: data.invoice_prefix,
        footer: data.receipt_footer,
      },
    });
  } catch {
    return responseError("Hosted business settings are not configured.", 503);
  }
}

export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return responseError("The request body must be valid JSON.", 400);
  }

  const parsed = businessSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Business settings are invalid.", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { supabase, user } = await authenticatedClient();
    if (!supabase || !user) return responseError("Authentication is required.", 401);

    const membership = await memberBusinessId(supabase, user.id);
    if (membership.error) return responseError(membership.error.message, 502);
    if (!membership.businessId) return responseError("No business is configured for this account.", 404);

    const { data, error } = await supabase
      .from("businesses")
      .update({
        legal_name: parsed.data.name,
        trn: parsed.data.trn,
        address: parsed.data.address,
        phone: parsed.data.phone,
        invoice_prefix: parsed.data.prefix,
        receipt_footer: parsed.data.footer,
        updated_at: new Date().toISOString(),
      })
      .eq("id", membership.businessId)
      .select(businessSelect)
      .maybeSingle();

    if (error) return responseError(error.message, 502);
    // RLS only lets owners update the business, so a member without that role gets no row back.
    if (!data) return responseError("Only the owner can change business settings.", 403);

    return Response.json({
      business: {
        id: data.id,
        name: data.legal_name,
        trn: data.trn,
        address: data.address,
        phone: data.phone,
        prefix: data.invoice_prefix,
        footer: data.receipt_footer,
      },
    });
  } catch {
    return responseError("Hosted business settings are not configured.", 503);
  }
}