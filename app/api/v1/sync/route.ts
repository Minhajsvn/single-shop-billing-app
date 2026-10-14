import { requestSchema, rpcPayloadFor } from "@/lib/sync/request-schema";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";


type OperationResult = {
  id: string;
  status: "accepted" | "rejected";
  error?: string;
};

export async function POST(request: Request) {
  let supabase;
  try {
    supabase = await createServerSupabaseClient();
  } catch {
    return Response.json({ error: "Hosted synchronization is not configured." }, { status: 503 });
  }

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return Response.json({ error: "Authentication is required." }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json({ error: "The sync request is invalid.", details: parsed.error.flatten() }, { status: 400 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("business_members")
    .select("business_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    return Response.json({ error: membershipError.message }, { status: 502 });
  }
  if (!membership) {
    return Response.json({ error: "No business is configured for this account." }, { status: 409 });
  }
  const business = { id: membership.business_id as string };

  const results: OperationResult[] = [];
  for (const operation of parsed.data.operations) {
    const targetId = operation.entity === "register"
      ? null
      : operation.entity === "customer"
        ? operation.payload.customer.id
        : operation.entity === "sale"
          ? operation.payload.sale.id
          : operation.entity === "credit-note"
          ? operation.payload.creditNote.id
          : operation.payload.movement.id;

    if (targetId !== null && operation.entityId !== targetId) {
      results.push({ id: operation.id, status: "rejected", error: "The operation and entity IDs do not match." });
      continue;
    }

    const functionName = operation.entity === "customer"
      ? "apply_customer_sync"
      : operation.entity === "sale"
        ? "apply_sale_sync"
        : operation.entity === "credit-note"
          ? "apply_credit_note_sync"
          : operation.entity === "stock"
            ? "apply_stock_sync"
            : "apply_register_sync";
    const payload = rpcPayloadFor(operation);

    const { error } = await supabase.rpc(functionName, {
      p_operation_id: operation.id,
      p_business_id: business.id,
      p_entity_id: operation.entityId,
      p_payload: payload,
    });

    if (error) {
      results.push({ id: operation.id, status: "rejected", error: error.message });
    } else {
      results.push({ id: operation.id, status: "accepted" });
    }
  }

  return Response.json({ operations: results });
}
