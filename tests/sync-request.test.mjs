import assert from "node:assert/strict";
import test from "node:test";
import { requestSchema, rpcPayloadFor } from "../lib/sync/request-schema.ts";

const deviceId = "d0000000-0000-4000-8000-00000000000a";
const customer = { id: "c0000000-0000-4000-8000-000000000001", name: "Omar", phone: "+971 55 555 0198", createdAt: "2026-10-14T08:00:00Z", updatedAt: "2026-10-14T08:00:00Z" };
const register = { id: "e0000000-0000-4000-8000-000000000001", status: "open", openedAt: "2026-10-14T04:00:00Z", openingCashFils: 10000, adjustments: [] };
const base = (entity, entityId, payload) => ({ id: "0p000000-0000-4000-8000-000000000001".replace("p", "0"), entity, entityId, createdAt: "2026-10-14T08:00:00Z", payload });

test("deviceId survives validation on every operation type", () => {
  const parsed = requestSchema.parse({ operations: [
    base("customer", customer.id, { customer, deviceId }),
    base("register", register.id, { action: "open", register, deviceId }),
  ] });
  assert.equal(parsed.operations[0].payload.deviceId, deviceId);
  assert.equal(parsed.operations[1].payload.deviceId, deviceId);
});

test("operations queued before Stage 1B (no deviceId) are still accepted", () => {
  const parsed = requestSchema.parse({ operations: [base("customer", customer.id, { customer })] });
  assert.equal(parsed.operations[0].payload.deviceId, undefined);
});

test("a malformed deviceId is rejected", () => {
  assert.equal(requestSchema.safeParse({ operations: [base("customer", customer.id, { customer, deviceId: "till-1" })] }).success, false);
});

test("customer RPC payload is the customer object with the deviceId merged in", () => {
  const [operation] = requestSchema.parse({ operations: [base("customer", customer.id, { customer, deviceId })] }).operations;
  assert.deepEqual(rpcPayloadFor(operation), { ...customer, deviceId });
});

test("other RPC payloads pass through with their deviceId", () => {
  const [operation] = requestSchema.parse({ operations: [base("register", register.id, { action: "open", register, deviceId })] }).operations;
  assert.equal(rpcPayloadFor(operation).deviceId, deviceId);
  assert.equal(rpcPayloadFor(operation).action, "open");
});

test("sale lines keep their list price through validation", () => {
  const sale = {
    id: "a1000000-0000-4000-8000-000000000001", invoiceNumber: "SMK-1-261015-0001", status: "completed",
    createdAt: "2026-10-15T08:00:00Z", supplyDate: "2026-10-15", paymentMethod: "cash",
    netFils: 230, vatFils: 12, grossFils: 242,
    lines: [{ id: "a1000000-0000-4000-8000-0000000000a1", name: "Coffee", quantity: 1, unitGrossFils: 242, listUnitGrossFils: 285, netFils: 230, vatFils: 12, grossFils: 242 }],
  };
  const parsed = requestSchema.parse({ operations: [base("sale", sale.id, { sale, deviceId })] });
  assert.equal(parsed.operations[0].payload.sale.lines[0].listUnitGrossFils, 285);
});

const productRecord = { id: "c1900000-0000-4000-8000-000000000001", name: "Green tea", sku: "TEA-19", priceFils: 650, lowStockThreshold: 3, active: true, taxCategory: "zero" };
const movement = (type, extra = {}) => ({ id: "f2000000-0000-4000-8000-000000000001", productId: productRecord.id, delta: 30, type, reason: "Spreadsheet import", createdAt: "2026-10-18T08:00:00Z", ...extra });

test("a product operation parses and passes through to apply_product_sync", () => {
  const parsed = requestSchema.parse({ operations: [base("product", productRecord.id, { product: productRecord, deviceId })] });
  assert.deepEqual(rpcPayloadFor(parsed.operations[0]), { product: productRecord, deviceId });
});

test("a product operation with an unknown VAT category is rejected", () => {
  assert.equal(requestSchema.safeParse({ operations: [base("product", productRecord.id, { product: { ...productRecord, taxCategory: "reduced" } })] }).success, false);
});

test("an import-count needs countedStock; a stock operation may omit the product copy", () => {
  const withoutCount = base("stock", movement("import-count").id, { movement: movement("import-count") });
  assert.equal(requestSchema.safeParse({ operations: [withoutCount] }).success, false);
  const withCount = base("stock", movement("import-count").id, { movement: movement("import-count"), countedStock: 40 });
  assert.equal(requestSchema.parse({ operations: [withCount] }).operations[0].payload.countedStock, 40);
  const slimReceipt = base("stock", movement("receipt").id, { movement: movement("receipt", { delta: 5 }) });
  assert.equal(requestSchema.safeParse({ operations: [slimReceipt] }).success, true);
});

test("Stage 2B: a split sale keeps its payments through validation; bad payments are refused", () => {
  const sale = {
    id: "a1000000-0000-4000-8000-000000000002", invoiceNumber: "SMK-1-261109-0001", status: "completed",
    createdAt: "2026-11-09T08:00:00Z", supplyDate: "2026-11-09", paymentMethod: "split",
    netFils: 7352, vatFils: 368, grossFils: 7720,
    lines: [{ id: "a1000000-0000-4000-8000-0000000000a2", name: "Dates", quantity: 1, unitGrossFils: 7720, netFils: 7352, vatFils: 368, grossFils: 7720 }],
    payments: [
      { id: "a1000000-0000-4000-8000-0000000000b1", method: "cash", amountFils: 5000 },
      { id: "a1000000-0000-4000-8000-0000000000b2", method: "transfer", amountFils: 2720, reference: "TT-123" },
    ],
  };
  const [operation] = requestSchema.parse({ operations: [base("sale", sale.id, { sale, deviceId })] }).operations;
  assert.deepEqual(rpcPayloadFor(operation).sale.payments, sale.payments);
  const withPayment = (payment) => ({ operations: [base("sale", sale.id, { sale: { ...sale, payments: [payment] }, deviceId })] });
  assert.equal(requestSchema.safeParse(withPayment({ id: "a1000000-0000-4000-8000-0000000000b3", method: "split", amountFils: 7720 })).success, false);
  assert.equal(requestSchema.safeParse(withPayment({ id: "a1000000-0000-4000-8000-0000000000b3", method: "transfer", amountFils: 7720, reference: "x".repeat(61) })).success, false);
  assert.equal(requestSchema.safeParse(withPayment({ id: "a1000000-0000-4000-8000-0000000000b3", method: "card", amountFils: 0 })).success, false);
});

test("Stage 2F: sale lines carry weightGrams 1–100000; product records carry soldByWeight and scaleCode", () => {
  const saleWith = (weightGrams) => ({
    id: "a1000000-0000-4000-8000-000000000002", invoiceNumber: "SMK-1-261113-0001", status: "completed",
    createdAt: "2026-11-13T08:00:00Z", supplyDate: "2026-11-13", paymentMethod: "cash", netFils: 2857, vatFils: 143, grossFils: 3000,
    lines: [{ id: "a1000000-0000-4000-8000-0000000000a2", productId: productRecord.id, name: "Dates", quantity: 1, unitGrossFils: 3000, netFils: 2857, vatFils: 143, grossFils: 3000, weightGrams }],
  });
  const parse = (weightGrams) => requestSchema.safeParse({ operations: [base("sale", "a1000000-0000-4000-8000-000000000002", { sale: saleWith(weightGrams), deviceId })] });
  assert.equal(parse(750).data.operations[0].payload.sale.lines[0].weightGrams, 750);
  assert.equal(parse(0).success, false);
  assert.equal(parse(100001).success, false);
  const product = (extra) => requestSchema.safeParse({ operations: [base("product", productRecord.id, { product: { ...productRecord, ...extra }, deviceId })] });
  assert.deepEqual(product({ soldByWeight: true, scaleCode: 1234 }).data.operations[0].payload.product.scaleCode, 1234);
  assert.equal(product({ soldByWeight: true, scaleCode: null }).success, true);
  assert.equal(product({ scaleCode: 0 }).success, false);
  assert.equal(product({ scaleCode: 1000000 }).success, false);
});
