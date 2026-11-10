import assert from "node:assert/strict";
import test from "node:test";
import { categoryName, categorySyncProblems, liveCategories, normalizeCategories, supersedeCategoryOperations, validCategoryName } from "../lib/catalogue/categories.ts";
import { syncOrder } from "../lib/store/product-sync.ts";
import { rejectionText } from "../lib/sync/rejections.ts";
import { requestSchema, rpcPayloadFor } from "../lib/sync/request-schema.ts";
import { mapSnapshotRows } from "../lib/snapshot/map-rows.ts";
import { mergeSnapshot } from "../lib/snapshot/merge.ts";

const drinks = { id: "c1", name: "Drinks", sortOrder: 1, archived: false };
const snacks = { id: "c2", name: "Snacks", sortOrder: 0, archived: false };
const old = { id: "c3", name: "Old", sortOrder: 0, archived: true };
const apples = { id: "c4", name: "Apples", sortOrder: 1, archived: false };

test("validCategoryName: blank, too long, a live clash, an archived name, renaming itself", () => {
  assert.equal(validCategoryName("  ", []), "Enter a category name.");
  assert.equal(validCategoryName("x".repeat(41), []), "Use at most 40 characters.");
  assert.equal(validCategoryName("x".repeat(40), []), null);
  assert.equal(validCategoryName(" drinks ", [drinks]), "A category with this name already exists");
  assert.equal(validCategoryName("old", [old]), null);
  assert.equal(validCategoryName("DRINKS", [drinks], "c1"), null);
});

test("liveCategories drops archived ones and orders by sortOrder then name", () => {
  assert.deepEqual(liveCategories([drinks, snacks, old, apples]).map((c) => c.id), ["c2", "c4", "c1"]);
});

test("categoryName: a missing or archived category reads Uncategorised", () => {
  assert.equal(categoryName([drinks, old], "c1"), "Drinks");
  assert.equal(categoryName([drinks, old], "c3"), "Uncategorised");
  assert.equal(categoryName([drinks], undefined), "Uncategorised");
  assert.equal(categoryName([drinks], "gone"), "Uncategorised");
});

test("normalizeState defaults categories: saved state from before 2C has none", () => {
  assert.deepEqual(normalizeCategories(undefined), []);
  assert.deepEqual(normalizeCategories("junk"), []);
  assert.deepEqual(normalizeCategories([drinks]), [drinks]);
});

const categoryOp = (id, categoryId, createdAt, status = "pending") => ({ id, entity: "category", entityId: categoryId, createdAt, status, payload: { category: { ...drinks, id: categoryId } } });
const productOp = (id, productId, createdAt, categoryId, status = "pending") => ({
  id, entity: "product", entityId: productId, createdAt, status,
  payload: { product: { id: productId, name: productId, sku: productId, priceFils: 100, lowStockThreshold: 0, active: true, taxCategory: "standard", ...(categoryId === undefined ? {} : { categoryId }) } },
});

test("syncOrder puts category ops before products that use them", () => {
  const ops = [
    productOp("p1", "pa", "2026-11-10T10:00:00.000Z", "c9"),
    productOp("p2", "pb", "2026-11-10T10:00:00.001Z"),
    categoryOp("k1", "c9", "2026-11-10T10:00:00.005Z"),
  ];
  assert.deepEqual(syncOrder(ops).map((op) => op.id), ["k1", "p1", "p2"]);
});

test("syncOrder leaves a category op in place when no earlier product needs it", () => {
  const ops = [productOp("p1", "pa", "2026-11-10T10:00:00.000Z", null), categoryOp("k1", "c9", "2026-11-10T10:00:00.005Z")];
  assert.deepEqual(syncOrder(ops).map((op) => op.id), ["p1", "k1"]);
});

test("a new category op drops earlier unsent ones for the same category", () => {
  const ops = [categoryOp("k1", "c9", "a"), categoryOp("k2", "c9", "b", "synced"), categoryOp("k3", "c8", "c")];
  assert.deepEqual(supersedeCategoryOperations(ops, "c9").map((op) => op.id), ["k2", "k3"]);
});

test("categorySyncProblems: only the latest op per category decides", () => {
  const ops = [
    { ...categoryOp("k1", "c9", "2026-11-10T10:00:00.000Z", "failed"), error: "category_name_taken" },
    { ...categoryOp("k2", "c8", "2026-11-10T10:00:00.000Z", "failed"), error: "category_name_taken" },
    categoryOp("k3", "c8", "2026-11-10T10:00:00.001Z"),
  ];
  assert.deepEqual([...categorySyncProblems(ops)], [["c9", "A category with this name already exists"]]);
});

test("category rejections read in the owner's words", () => {
  assert.equal(rejectionText("category_name_taken"), "A category with this name already exists");
  assert.equal(rejectionText("category_not_found"), "This product's category has not reached the server; sync again.");
});

const deviceId = "d0000000-0000-4000-8000-000000000001";
const categoryRecord = { id: "ca000000-0000-4000-8000-000000000001", name: "Drinks", sortOrder: 0, archived: false };

test("a category operation parses and passes through to apply_category_sync", () => {
  const op = { id: "0c000000-0000-4000-8000-000000000001", entity: "category", entityId: categoryRecord.id, createdAt: "2026-11-10T08:00:00Z", payload: { category: categoryRecord, deviceId } };
  const parsed = requestSchema.parse({ operations: [op] });
  assert.deepEqual(rpcPayloadFor(parsed.operations[0]), { category: categoryRecord, deviceId });
  assert.equal(requestSchema.safeParse({ operations: [{ ...op, payload: { category: { ...categoryRecord, name: "x".repeat(41) }, deviceId } }] }).success, false);
});

test("product records accept a null or uuid categoryId, nothing else", () => {
  const product = { id: "c1900000-0000-4000-8000-000000000001", name: "Tea", sku: "TEA", priceFils: 650, lowStockThreshold: 3, active: true, taxCategory: "zero" };
  const op = (extra) => ({ operations: [{ id: "0d000000-0000-4000-8000-000000000001", entity: "product", entityId: product.id, createdAt: "2026-11-10T08:00:00Z", payload: { product: { ...product, ...extra }, deviceId } }] });
  assert.equal(requestSchema.safeParse(op({ categoryId: null })).success, true);
  assert.equal(requestSchema.safeParse(op({ categoryId: categoryRecord.id })).success, true);
  assert.equal(requestSchema.safeParse(op({ categoryId: "drinks" })).success, false);
});

const baseRows = {
  business: { id: "biz", legal_name: "Smoke LLC", trn: "100000000000003", address: "Dubai", phone: "+971", invoice_prefix: "SMK", receipt_footer: "Thanks", country: "AE", currency: "AED" },
  devices: [], role: "owner", customers: [], sales: [], creditNotes: [], stockMovements: [], register: null,
  products: [
    { id: "p1", name: "Cola", sku: "COLA", barcode: null, price_fils: 2100, stock_quantity: 4, low_stock_threshold: 0, status: "active", tax_category: "standard", category_id: "c1" },
    { id: "p2", name: "Soap", sku: "SOAP", barcode: null, price_fils: 1050, stock_quantity: 4, low_stock_threshold: 0, status: "active", tax_category: "standard", category_id: null },
  ],
  categories: [
    { id: "c1", name: "Drinks", sort_order: 1, archived_at: null },
    { id: "c3", name: "Old", sort_order: 0, archived_at: "2026-11-01T00:00:00Z" },
  ],
};

test("mapSnapshotRows maps categories and each product's category", () => {
  const state = mapSnapshotRows(baseRows, "x").state;
  assert.deepEqual(state.categories, [{ id: "c1", name: "Drinks", sortOrder: 1, archived: false }, { id: "c3", name: "Old", sortOrder: 0, archived: true }]);
  assert.deepEqual(state.products.map((p) => p.categoryId), ["c1", null]);
  assert.deepEqual(mapSnapshotRows({ ...baseRows, categories: undefined }, "x").state.categories, []);
});

test("a pending category stays visible after a refresh; a synced one comes only from the server", () => {
  const empty = { products: [], categories: [], stockMovements: [], sales: [], customers: [], creditNotes: [], syncOperations: [], register: null };
  const server = { ...empty, categories: [drinks] };
  const renamed = { ...drinks, name: "Cold drinks" };
  const local = { ...empty, syncOperations: [{ id: "k1", entity: "category", entityId: "c1", createdAt: "a", status: "pending", payload: { category: renamed } },
    { id: "k2", entity: "category", entityId: "c2", createdAt: "b", status: "pending", payload: { category: snacks } }] };
  assert.deepEqual(mergeSnapshot(server, local).categories, [snacks, renamed]);
  const synced = { ...empty, syncOperations: [{ ...local.syncOperations[0], status: "synced" }] };
  assert.deepEqual(mergeSnapshot(server, synced).categories, [drinks]);
});

test("filterByCategory: the chip filters, a search looks across every category, archived products never show", async () => {
  const { filterByCategory } = await import("../lib/catalogue/categories.ts");
  const p = (id, name, categoryId, active = true) => ({ id, name, sku: id.toUpperCase(), priceFils: 100, stock: 1, lowStockThreshold: 0, active, taxCategory: "standard", categoryId });
  const products = [p("a", "Cola", "c1"), p("b", "Biscuits", null), p("c", "Cold brew", "c1", false), p("d", "Bubble gum", "c2")];
  assert.deepEqual(filterByCategory(products, "c1", "").map((x) => x.id), ["a"]);
  assert.deepEqual(filterByCategory(products, "all", "").map((x) => x.id), ["a", "b", "d"]);
  assert.deepEqual(filterByCategory(products, "c1", "b").map((x) => x.id), ["b", "d"]);
  assert.deepEqual(filterByCategory(products, "c2", "  ").map((x) => x.id), ["d"]);
});
