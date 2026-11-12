import assert from "node:assert/strict";
import test from "node:test";
import { heldStockOperations, productSyncProblems, stampSequence, supersedeProductOperations, syncOrder, withTaxCategories } from "../lib/store/product-sync.ts";
import { rejectionText } from "../lib/sync/rejections.ts";

const record = (id) => ({ id, name: id, sku: id.toUpperCase(), priceFils: 100, lowStockThreshold: 5, active: true, taxCategory: "standard" });
const productOp = (id, productId, status, createdAt, error) => ({ id, entity: "product", entityId: productId, createdAt, status, ...(error ? { error } : {}), payload: { product: record(productId) } });
const stockOp = (id, productId, status = "pending", createdAt = "2026-10-18T10:00:00.005Z") => ({
  id, entity: "stock", entityId: `m-${id}`, createdAt, status,
  payload: { movement: { id: `m-${id}`, productId, delta: 3, type: "opening", reason: "Opening stock", createdAt } },
});

test("stampSequence gives strictly increasing createdAt in queue order", () => {
  const stamped = stampSequence([{ createdAt: "" }, { createdAt: "" }, { createdAt: "" }], new Date("2026-10-18T10:00:00.000Z"));
  assert.deepEqual(stamped.map((op) => op.createdAt), ["2026-10-18T10:00:00.000Z", "2026-10-18T10:00:00.001Z", "2026-10-18T10:00:00.002Z"]);
});

test("stock operations wait behind a failed product operation, not behind a synced one", () => {
  const ops = [
    productOp("pa", "a", "failed", "2026-10-18T10:00:00.000Z", "product_barcode_taken"),
    stockOp("sa", "a"),
    productOp("pb", "b", "synced", "2026-10-18T10:00:00.001Z"),
    stockOp("sb", "b"),
    stockOp("sc", "c"),
  ];
  assert.deepEqual([...heldStockOperations(ops)], ["sa"]);
});

test("only the latest product operation decides: a newer pending edit releases held stock", () => {
  const ops = [
    productOp("old", "a", "failed", "2026-10-18T10:00:00.000Z", "product_sku_taken"),
    productOp("new", "a", "pending", "2026-10-18T10:05:00.000Z"),
    stockOp("sa", "a"),
  ];
  assert.equal(heldStockOperations(ops).size, 0);
  assert.equal(productSyncProblems(ops).size, 0);
});

test("productSyncProblems explains failed products in the owner's words", () => {
  const problems = productSyncProblems([productOp("pa", "a", "failed", "2026-10-18T10:00:00.000Z", "product_barcode_taken")]);
  assert.deepEqual([...problems], [["a", "Another product already uses this barcode."]]);
});

test("supersedeProductOperations drops earlier unsynced product operations for that product only", () => {
  const ops = [
    productOp("p1", "a", "failed", "2026-10-18T10:00:00.000Z", "product_sku_taken"),
    productOp("p2", "a", "pending", "2026-10-18T10:01:00.000Z"),
    productOp("p3", "a", "synced", "2026-10-18T09:00:00.000Z"),
    productOp("p4", "b", "pending", "2026-10-18T10:02:00.000Z"),
    stockOp("sa", "a"),
  ];
  assert.deepEqual(supersedeProductOperations(ops, "a").map((op) => op.id), ["p3", "p4", "sa"]);
});

test("syncOrder sends a product operation before the earliest unsynced stock or sale that needs it", () => {
  // The import's opening stock failed because its product was refused; the owner fixed the product later.
  const ops = [
    stockOp("open", "a", "failed", "2026-10-18T10:00:00.001Z"),
    stockOp("other", "b", "pending", "2026-10-18T10:00:00.002Z"),
    productOp("fixed", "a", "pending", "2026-10-18T10:05:00.000Z"),
    productOp("pb", "b", "pending", "2026-10-18T09:59:00.000Z"),
  ];
  assert.deepEqual(syncOrder(ops).map((op) => op.id), ["pb", "fixed", "open", "other"]);
});

test("syncOrder keeps stock counts and sales in their own order around a later product edit", () => {
  // Count 40 at t1, sale of 3 at t2, price edit at t3: the server must end at 37, as the till shows.
  const count = { ...stockOp("count", "a", "pending", "2026-10-18T10:00:01.000Z") };
  const sale = { id: "sale", entity: "sale", entityId: "s1", createdAt: "2026-10-18T10:00:02.000Z", status: "pending", payload: { sale: { id: "s1", lines: [{ productId: "a", quantity: 3 }] } } };
  const edit = productOp("edit", "a", "pending", "2026-10-18T10:00:03.000Z");
  assert.deepEqual(syncOrder([edit, sale, count]).map((op) => op.id), ["edit", "count", "sale"]);
});

test("a sale of a product the server refused is held with its stock", () => {
  const ops = [
    productOp("pa", "a", "failed", "2026-10-18T10:00:00.000Z", "product_sku_taken"),
    { id: "sale", entity: "sale", entityId: "s1", createdAt: "2026-10-18T10:01:00.000Z", status: "pending", payload: { sale: { id: "s1", lines: [{ productId: "a", quantity: 1 }] } } },
  ];
  assert.deepEqual([...heldStockOperations(ops)], ["sale"]);
});

test("withTaxCategories defaults products saved before Stage 1D to standard and keeps known categories", () => {
  const legacy = { id: "a", name: "A", sku: "A", priceFils: 1, stock: 1, lowStockThreshold: 1, active: true };
  assert.deepEqual(withTaxCategories([legacy, { ...legacy, id: "b", taxCategory: "zero" }]).map((p) => p.taxCategory), ["standard", "zero"]);
});

test("rejectionText maps server codes and passes unknown ones through", () => {
  assert.equal(rejectionText("product_sku_taken"), "Another product already uses this SKU.");
  assert.equal(rejectionText("product_barcode_taken"), "Another product already uses this barcode.");
  assert.equal(rejectionText("plan_limit_reached"), "Your plan's product limit is reached: upgrade to Pro or archive products.");
  assert.equal(rejectionText("something_else"), "something_else");
});

test("Stage 2F: the product record sent to the server carries soldByWeight and scaleCode", async () => {
  const { productRecordOf } = await import("../lib/store/product-sync.ts");
  const product = { id: "p1", name: "Dates", sku: "DAT", priceFils: 4000, stock: 0, lowStockThreshold: 500, active: true, taxCategory: "standard", soldByWeight: true, scaleCode: 1234 };
  assert.deepEqual(productRecordOf(product), { id: "p1", name: "Dates", sku: "DAT", barcode: undefined, priceFils: 4000, lowStockThreshold: 500, active: true, taxCategory: "standard", categoryId: null, soldByWeight: true, scaleCode: 1234 });
  assert.deepEqual(productRecordOf({ ...product, soldByWeight: undefined, scaleCode: undefined }).soldByWeight, false);
  assert.equal(productRecordOf({ ...product, scaleCode: undefined }).scaleCode, null);
});

test("Stage 2F: weighing changes are checked on the till: a used scale code, or a switch with stock", async () => {
  const { weighingProblem } = await import("../lib/store/product-sync.ts");
  const dates = { id: "p1", name: "Dates", sku: "DAT", priceFils: 4000, stock: 0, lowStockThreshold: 0, active: true, taxCategory: "standard", soldByWeight: true, scaleCode: 1234 };
  const nuts = { ...dates, id: "p2", name: "Nuts", sku: "NUT", stock: 5, soldByWeight: false, scaleCode: null };
  const products = [dates, nuts];
  assert.equal(weighingProblem(products, { ...nuts, scaleCode: 1234 }, nuts), "Scale code 1234 is already used by Dates.");
  assert.equal(weighingProblem(products, { ...nuts, soldByWeight: true }, nuts), "Set stock to 0 before changing how this product is sold.");
  assert.equal(weighingProblem(products, { ...dates, scaleCode: 1234, name: "Medjool" }, dates), null, "its own code");
  assert.equal(weighingProblem(products, { ...nuts, scaleCode: 0 }, nuts), "Scale codes are whole numbers from 1 to 999999.");
  assert.equal(weighingProblem(products, { ...nuts, id: "new", stock: 2500, soldByWeight: true }, null), null, "a new product starts with its opening stock");
});

test("final review I1: the catalog upload leaves weighed products out, on either side", async () => {
  const { catalogUploadPlan } = await import("../lib/store/product-sync.ts");
  const base = { priceFils: 100, stock: 5, lowStockThreshold: 0, active: true, taxCategory: "standard" };
  const plan = catalogUploadPlan([
    { ...base, id: "a", name: "Cola", sku: "COLA" },
    { ...base, id: "b", name: "Dates", sku: "DAT", soldByWeight: true, stock: 5000 },
    { ...base, id: "c", name: "Nuts", sku: "NUT" },
  ], new Set(["NUT"]));
  assert.deepEqual(plan.upload.map((p) => p.sku), ["COLA"]);
  assert.deepEqual(plan.skipped, [
    "Product DAT: sold by weight; add it in your shop's Inventory instead.",
    "Product NUT: sold by weight in your shop; change it there instead.",
  ]);
});
