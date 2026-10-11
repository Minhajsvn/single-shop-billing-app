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

export async function GET() {
  try {
    const { supabase, user } = await authenticatedClient();
    if (!supabase || !user) return responseError("Authentication is required.", 401);

    const { data, error } = await supabase
      .from("businesses")
      .select(businessSelect)
      .eq("owner_id", user.id)
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
      .eq("owner_id", user.id)
      .select(businessSelect)
      .single();

    if (error || !data) return responseError(error?.message ?? "Business settings could not be saved.", 502);

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