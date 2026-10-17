import assert from "node:assert/strict";
import test from "node:test";
import { mergeSnapshot } from "../lib/snapshot/merge.ts";

const product = { id: "p1", name: "Coffee", sku: "COF", priceFils: 2850, stock: 10, lowStockThreshold: 2, active: true };
const line = { id: "l1", productId: "p1", name: "Coffee", sku: "COF", quantity: 2, unitGrossFils: 2850, netFils: 5429, vatFils: 271, grossFils: 5700 };
const sale = { id: "s-local", invoiceNumber: "SMK-1-261013-0003", createdAt: "2026-10-13T09:00:00Z", supplyDate: "2026-10-13", paymentMethod: "cash", lines: [line], netFils: 5429, vatFils: 271, grossFils: 5700, status: "completed" };
const empty = { products: [], stockMovements: [], sales: [], customers: [], creditNotes: [], syncOperations: [], register: null };
const server = { ...empty, products: [product] };
const op = (status, entity = "sale", payload = { sale }) => ({ id: `op-${status}-${entity}`, entity, entityId: payload.sale?.id ?? "x", createdAt: "2026-10-13T09:00:00Z", status, payload });

test("pending local sale survives a refresh and decrements server stock once", () => {
  const local = { ...empty, products: [{ ...product, stock: 8 }], sales: [sale], syncOperations: [op("pending")] };
  const merged = mergeSnapshot(server, local);
  assert.deepEqual(merged.sales.map((s) => s.id), ["s-local"]);
  assert.equal(merged.products[0].stock, 8);
  assert.equal(merged.syncOperations.length, 1);
});

test("once the server has the sale, it is not duplicated or double-decremented", () => {
  const serverWithSale = { ...server, products: [{ ...product, stock: 8 }], sales: [sale] };
  const local = { ...empty, sales: [sale], syncOperations: [op("pending")] };
  const merged = mergeSnapshot(serverWithSale, local);
  assert.equal(merged.sales.length, 1);
  assert.equal(merged.products[0].stock, 8);
});

test("synced operations are dropped and their entities come only from the server", () => {
  const merged = mergeSnapshot(server, { ...empty, sales: [sale], syncOperations: [op("synced")] });
  assert.equal(merged.sales.length, 0);
  assert.equal(merged.syncOperations.length, 0);
});

test("failed operations are kept for review", () => {
  assert.equal(mergeSnapshot(server, { ...empty, sales: [sale], syncOperations: [op("failed")] }).syncOperations.length, 1);
});

test("a pending local register replaces the server register", () => {
  const register = { id: "r-local", status: "open", openedAt: "2026-10-13T04:00:00Z", openingCashFils: 100, adjustments: [] };
  const merged = mergeSnapshot({ ...server, register: null }, { ...empty, register, syncOperations: [op("pending", "register", { action: "open", register })] });
  assert.equal(merged.register?.id, "r-local");
});

test("a pending customer edit wins over the server copy", () => {
  const serverCustomer = { id: "c1", name: "Old", phone: "1", createdAt: "a", updatedAt: "a" };
  const localCustomer = { ...serverCustomer, name: "New", updatedAt: "b" };
  const merged = mergeSnapshot({ ...server, customers: [serverCustomer] }, { ...empty, customers: [localCustomer], syncOperations: [{ ...op("pending", "customer", { customer: localCustomer }), entityId: "c1" }] });
  assert.equal(merged.customers[0].name, "New");
});

test("a pending stock movement for a product the server lacks adds it at 0 then applies the delta", () => {
  const newProduct = { ...product, id: "p-new", sku: "NEW", stock: 5 };
  const movement = { id: "m1", productId: "p-new", delta: 5, type: "opening", reason: "Opening stock", createdAt: "2026-10-13T09:00:00Z" };
  const stockOp = { id: "op-stock", entity: "stock", entityId: "m1", createdAt: "2026-10-13T09:00:00Z", status: "pending", payload: { movement, product: newProduct } };
  const merged = mergeSnapshot(server, { ...empty, syncOperations: [stockOp] });
  assert.equal(merged.products.length, 2);
  assert.equal(merged.products.find((p) => p.id === "p-new")?.stock, 5);
  assert.equal(merged.products.find((p) => p.id === "p1")?.stock, 10);
  assert.deepEqual(merged.stockMovements.map((m) => m.id), ["m1"]);
});

test("R9: a failed register op does not override the server register", () => {
  const serverRegister = { id: "r-server", status: "open", openedAt: "2026-10-13T04:00:00Z", openingCashFils: 500, adjustments: [] };
  const localRegister = { id: "r-local", status: "open", openedAt: "2026-10-13T05:00:00Z", openingCashFils: 100, adjustments: [] };
  const merged = mergeSnapshot({ ...server, register: serverRegister }, { ...empty, register: localRegister, syncOperations: [op("failed", "register", { action: "open", register: localRegister })] });
  assert.equal(merged.register?.id, "r-server");
  assert.equal(merged.syncOperations.length, 1, "failed op stays visible for review");
});

test("R9: a failed customer op does not override the server customer", () => {
  const serverCustomer = { id: "c1", name: "Server", phone: "1", createdAt: "a", updatedAt: "a" };
  const localCustomer = { ...serverCustomer, name: "Rejected edit", updatedAt: "b" };
  const merged = mergeSnapshot({ ...server, customers: [serverCustomer] }, { ...empty, customers: [localCustomer], syncOperations: [{ ...op("failed", "customer", { customer: localCustomer }), entityId: "c1" }] });
  assert.deepEqual(merged.customers.map((c) => c.name), ["Server"]);
});

test("R9: a failed sale is still shown and deducts stock exactly once per merge", () => {
  const once = mergeSnapshot(server, { ...empty, sales: [sale], syncOperations: [op("failed")] });
  const again = mergeSnapshot(server, once);
  assert.deepEqual(once.sales.map((s) => s.id), ["s-local"]);
  assert.equal(once.products[0].stock, 8);
  assert.equal(again.products[0].stock, 8, "re-merging from the same server state does not compound");
});

test("R9: a pending register op with no local register keeps the server register", () => {
  const serverRegister = { id: "r-server", status: "open", openedAt: "2026-10-13T04:00:00Z", openingCashFils: 500, adjustments: [] };
  const merged = mergeSnapshot({ ...server, register: serverRegister }, { ...empty, register: null, syncOperations: [op("pending", "register", { action: "open", register: serverRegister })] });
  assert.equal(merged.register?.id, "r-server");
});

const productOp = (status, record, createdAt = "2026-10-18T09:00:00.000Z") => ({ id: `op-product-${status}-${record.id}`, entity: "product", entityId: record.id, createdAt, status, payload: { product: record } });
const coffeeRecord = Object.fromEntries(Object.entries(product).filter(([key]) => key !== "stock"));

test("a pending new product missing from the server survives a refresh with stock 0 plus its opening movement", () => {
  const record = { ...coffeeRecord, id: "p-new", sku: "NEW", name: "New tea", taxCategory: "standard" };
  const movement = { id: "m-open", productId: "p-new", delta: 4, type: "opening", reason: "Opening stock", createdAt: "2026-10-18T09:00:00.001Z" };
  const merged = mergeSnapshot(server, { ...empty, syncOperations: [
    { id: "op-open", entity: "stock", entityId: "m-open", createdAt: movement.createdAt, status: "pending", payload: { movement } },
    productOp("pending", record),
  ] });
  assert.equal(merged.products.find((p) => p.id === "p-new")?.stock, 4);
  assert.equal(merged.products.find((p) => p.id === "p-new")?.name, "New tea");
});

test("a pending import count sets stock, and a later pending sale still deducts", () => {
  const movement = { id: "m-count", productId: "p1", delta: 30, type: "import-count", reason: "Spreadsheet import", createdAt: "2026-10-18T09:00:00.000Z" };
  const laterSale = { ...sale, id: "s-later", createdAt: "2026-10-18T09:05:00.000Z" };
  const merged = mergeSnapshot({ ...server, products: [{ ...product, stock: 7 }] }, { ...empty, syncOperations: [
    { id: "op-sale", entity: "sale", entityId: "s-later", createdAt: "2026-10-18T09:05:00.000Z", status: "pending", payload: { sale: laterSale } },
    { id: "op-count", entity: "stock", entityId: "m-count", createdAt: movement.createdAt, status: "pending", payload: { movement, countedStock: 40 } },
  ] });
  assert.equal(merged.products[0].stock, 38);
});

test("a failed product operation keeps the local fields over the server copy, with the server's stock", () => {
  const merged = mergeSnapshot(server, { ...empty, syncOperations: [productOp("failed", { ...coffeeRecord, name: "Local name", taxCategory: "standard" })] });
  assert.equal(merged.products[0].name, "Local name");
  assert.equal(merged.products[0].stock, 10);
});
