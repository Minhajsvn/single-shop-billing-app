import { z } from "zod";

/** The till that created an operation. Optional so operations queued before Stage 1B still sync. */
const deviceIdSchema = z.string().uuid().optional();

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
  payload: z.object({ movement: stockMovementSchema, product: stockProductSchema, deviceId: deviceIdSchema }),
});
const customerOperationSchema = z.object({
  id: z.string().uuid(),
  entity: z.literal("customer"),
  entityId: z.string().uuid(),
  createdAt: z.string().min(1),
  payload: z.object({ customer: customerSchema, deviceId: deviceIdSchema }),
});

const saleOperationSchema = z.object({
  id: z.string().uuid(),
  entity: z.literal("sale"),
  entityId: z.string().uuid(),
  createdAt: z.string().min(1),
  payload: z.object({
    sale: saleSchema,
    register: registerSnapshotSchema.nullable().optional(),
    deviceId: deviceIdSchema,
  }),
});

const registerOperationSchema = z.object({
  id: z.string().uuid(),
  entity: z.literal("register"),
  entityId: z.string().uuid(),
  createdAt: z.string().min(1),
  payload: z.union([
    z.object({ action: z.literal("open"), register: registerSnapshotSchema, deviceId: deviceIdSchema }),
    z.object({ action: z.literal("adjustment"), registerId: z.string().min(1).max(100), adjustment: cashAdjustmentSchema, register: registerSnapshotSchema.nullable().optional(), deviceId: deviceIdSchema }),
    z.object({ action: z.literal("close"), register: registerSnapshotSchema, deviceId: deviceIdSchema }),
  ]),
});

const creditNoteOperationSchema = z.object({
  id: z.string().uuid(),
  entity: z.literal("credit-note"),
  entityId: z.string().uuid(),
  createdAt: z.string().min(1),
  payload: z.object({ creditNote: creditNoteSchema, deviceId: deviceIdSchema }),
});

export const requestSchema = z.object({
  operations: z.array(z.union([customerOperationSchema, saleOperationSchema, registerOperationSchema, creditNoteOperationSchema, stockOperationSchema])).min(1).max(50),
});

export type SyncRequest = z.infer<typeof requestSchema>;
export type SyncRequestOperation = SyncRequest["operations"][number];

/** The jsonb handed to the sync RPC. Customer RPCs read the customer fields at the top level, so the deviceId is merged into the customer. */
export function rpcPayloadFor(operation: SyncRequestOperation) {
  if (operation.entity === "customer") return { ...operation.payload.customer, deviceId: operation.payload.deviceId };
  return operation.payload;
}
