import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const customerSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().min(3).max(40),
  email: z.string().trim().max(320).optional(),
  address: z.string().trim().max(500).optional(),
  trn: z.string().regex(/^\d{15}$/).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const customerSnapshotSchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().min(3).max(40),
  email: z.string().trim().max(320).optional(),
  address: z.string().trim().max(500).optional(),
  trn: z.string().regex(/^\d{15}$/).optional(),
});

const saleLineSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().trim().min(1).max(100).optional(),
  name: z.string().trim().min(1).max(160),
  sku: z.string().trim().max(100).optional(),
  quantity: z.number().int().positive(),
  unitGrossFils: z.number().int().positive(),
  netFils: z.number().int().nonnegative(),
  vatFils: z.number().int().nonnegative(),
  grossFils: z.number().int().positive(),
});

const saleSchema = z.object({
  id: z.string().uuid(),
  invoiceNumber: z.string().trim().min(1).max(80),
  createdAt: z.string().min(1),
  supplyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentMethod: z.enum(["cash", "card"]),
  lines: z.array(saleLineSchema).min(1).max(100),
  netFils: z.number().int().nonnegative(),
  vatFils: z.number().int().nonnegative(),
  grossFils: z.number().int().positive(),
  customer: customerSnapshotSchema.optional(),
  status: z.literal("completed"),
});

const cashAdjustmentSchema = z.object({
  id: z.string().uuid(),
  amountFils: z.number().int().refine((value) => value !== 0),
  reason: z.string().trim().min(1).max(300),
  createdAt: z.string().min(1),
});

const registerSnapshotSchema = z.object({
  id: z.string().trim().min(1).max(100),
  status: z.enum(["open", "closed"]),
  openedAt: z.string().min(1),
  openingCashFils: z.number().int().nonnegative(),
  adjustments: z.array(cashAdjustmentSchema),
  closedAt: z.string().min(1).optional(),
  countedCashFils: z.number().int().nonnegative().optional(),
  expectedCashFils: z.number().int().optional(),
  varianceFils: z.number().int().optional(),
});

const creditNoteLineSchema = z.object({
  id: z.string().uuid(),
  originalLineId: z.string().uuid(),
  productId: z.string().trim().min(1).max(100).optional(),
  name: z.string().trim().min(1).max(160),
  sku: z.string().trim().max(100).optional(),
  quantity: z.number().int().positive(),
  unitGrossFils: z.number().int().positive(),
  netFils: z.number().int().nonnegative(),
  vatFils: z.number().int().nonnegative(),
  grossFils: z.number().int().positive(),
});

const creditNoteSchema = z.object({
  id: z.string().uuid(),
  creditNoteNumber: z.string().trim().min(1).max(80),
  saleId: z.string().uuid(),
  invoiceNumber: z.string().trim().min(1).max(80),
  createdAt: z.string().min(1),
  paymentMethod: z.enum(["cash", "card"]),
  lines: z.array(creditNoteLineSchema).min(1).max(100),
  netFils: z.number().int().nonnegative(),
  vatFils: z.number().int().nonnegative(),
  grossFils: z.number().int().positive(),
});

const stockProductSchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(160),
  sku: z.string().trim().min(1).max(100),
  barcode: z.string().trim().max(100).optional(),
  priceFils: z.number().int().positive(),
  stock: z.number().int().nonnegative(),
  lowStockThreshold: z.number().int().nonnegative(),
  active: z.boolean(),
});

const stockMovementSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().trim().min(1).max(100),
  delta: z.number().int().refine((value) => value !== 0),
  type: z.enum(["opening", "receipt", "correction-in", "correction-out"]),
  reason: z.string().trim().min(1).max(300),
  createdAt: z.string().min(1),
});

const stockOperationSchema = z.object({
  id: z.string().uuid(),
  entity: z.literal("stock"),
  entityId: z.string().uuid(),
  createdAt: z.string().min(1),
  payload: z.object({ movement: stockMovementSchema, product: stockProductSchema }),
});
const customerOperationSchema = z.object({
  id: z.string().uuid(),
  entity: z.literal("customer"),
  entityId: z.string().uuid(),
  createdAt: z.string().min(1),
  payload: z.object({ customer: customerSchema }),
});

const saleOperationSchema = z.object({
  id: z.string().uuid(),
  entity: z.literal("sale"),
  entityId: z.string().uuid(),
  createdAt: z.string().min(1),
  payload: z.object({
    sale: saleSchema,
    register: registerSnapshotSchema.nullable().optional(),
  }),
});

const registerOperationSchema = z.object({
  id: z.string().uuid(),
  entity: z.literal("register"),
  entityId: z.string().uuid(),
  createdAt: z.string().min(1),
  payload: z.union([
    z.object({ action: z.literal("open"), register: registerSnapshotSchema }),
    z.object({ action: z.literal("adjustment"), registerId: z.string().min(1).max(100), adjustment: cashAdjustmentSchema, register: registerSnapshotSchema.nullable().optional() }),
    z.object({ action: z.literal("close"), register: registerSnapshotSchema }),
  ]),
});

const creditNoteOperationSchema = z.object({
  id: z.string().uuid(),
  entity: z.literal("credit-note"),
  entityId: z.string().uuid(),
  createdAt: z.string().min(1),
  payload: z.object({ creditNote: creditNoteSchema }),
});

const requestSchema = z.object({
  operations: z.array(z.union([customerOperationSchema, saleOperationSchema, registerOperationSchema, creditNoteOperationSchema, stockOperationSchema])).min(1).max(50),
});

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

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (businessError) {
    return Response.json({ error: businessError.message }, { status: 502 });
  }
  if (!business) {
    return Response.json({ error: "No business is configured for this account." }, { status: 409 });
  }

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
    const payload = operation.entity === "customer" ? operation.payload.customer : operation.payload;

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
