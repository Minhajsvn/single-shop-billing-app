import assert from "node:assert/strict";
import test from "node:test";
import { checkoutLines, itemSummary, toCartInputs } from "../lib/promotions/cart.ts";
import { shouldRefresh, SNAPSHOT_REFRESH_MS } from "../lib/promotions/refresh.ts";

const products = [{ id: "p-cola", name: "Cola", sku: "COLA", priceFils: 600, stock: 9, lowStockThreshold: 0, active: true, taxCategory: "standard", categoryId: "c-drinks" },
  { id: "p-old", name: "Old", sku: "OLD", priceFils: 600, stock: 9, lowStockThreshold: 0, active: true, taxCategory: "standard", categoryId: "c-gone" }];
const categories = [{ id: "c-drinks", name: "Drinks", sortOrder: 0, archived: false }, { id: "c-gone", name: "Gone", sortOrder: 1, archived: true }];

test("toCartInputs: list price, manual discount and the product's live category", () => {
  const cart = [
    { key: "k1", productId: "p-cola", name: "Cola", sku: "COLA", quantity: 2, unitGrossFils: 600 },
    { key: "k2", productId: "p-cola", name: "Cola", quantity: 1, unitGrossFils: 500, listUnitGrossFils: 600 },
    { key: "k3", productId: "p-old", name: "Old", quantity: 1, unitGrossFils: 600 },
    { key: "k4", name: "Gift wrap", quantity: 1, unitGrossFils: 1000 },
  ];
  assert.deepEqual(toCartInputs(cart, products, categories), [
    { key: "k1", productId: "p-cola", categoryId: "c-drinks", name: "Cola", sku: "COLA", quantity: 2, listUnitGrossFils: 600 },
    { key: "k2", productId: "p-cola", categoryId: "c-drinks", name: "Cola", quantity: 1, listUnitGrossFils: 600, manualUnitGrossFils: 500 },
    { key: "k3", productId: "p-old", categoryId: null, name: "Old", quantity: 1, listUnitGrossFils: 600 },
    { key: "k4", categoryId: null, name: "Gift wrap", quantity: 1, listUnitGrossFils: 1000 },
  ]);
});

const priced = [
  { key: "k1", productId: "p-cola", name: "Cola", quantity: 3, unitGrossFils: 400, listUnitGrossFils: 600, promotionId: "pr1", promotionName: "Buy 2 get 1", promotionSavingFils: 600, manual: false },
  { key: "k1", productId: "p-cola", name: "Cola", quantity: 1, unitGrossFils: 600, listUnitGrossFils: 600, promotionSavingFils: 0, manual: false },
  { key: "k2", name: "Gift wrap", quantity: 1, unitGrossFils: 900, listUnitGrossFils: 1000, promotionSavingFils: 0, manual: true },
];

test("checkoutLines: list price only when charged less; promotion fields only when a promotion priced the line", () => {
  assert.deepEqual(checkoutLines(priced), [
    { productId: "p-cola", name: "Cola", quantity: 3, unitGrossFils: 400, listUnitGrossFils: 600, promotionId: "pr1", promotionName: "Buy 2 get 1", promotionSavingFils: 600 },
    { productId: "p-cola", name: "Cola", quantity: 1, unitGrossFils: 600 },
    { name: "Gift wrap", quantity: 1, unitGrossFils: 900, listUnitGrossFils: 1000 },
  ]);
});

test("itemSummary: total, promotion saving and name for one cart item", () => {
  assert.deepEqual(itemSummary(priced, "k1"), { totalFils: 1800, savingFils: 600, promotionName: "Buy 2 get 1" });
  assert.deepEqual(itemSummary(priced, "k2"), { totalFils: 900, savingFils: 0, promotionName: undefined });
});

test("tills refresh the snapshot every 5 minutes", () => {
  assert.equal(SNAPSHOT_REFRESH_MS, 300000);
  assert.equal(shouldRefresh(0, 299999), false);
  assert.equal(shouldRefresh(0, 300000), true);
});

test("daily report: Promotions saving is the day's sale lines' promotion savings", async () => {
  const { buildDailyReport } = await import("../lib/reporting.ts");
  const line = (id, saving) => ({ id, name: "Cola", quantity: 1, unitGrossFils: 600, netFils: 571, vatFils: 29, grossFils: 600, ...(saving ? { promotionId: "pr1", promotionSavingFils: saving } : {}) });
  const sale = { id: "s1", invoiceNumber: "A-1", createdAt: "2026-11-11T08:00:00Z", supplyDate: "2026-11-11", paymentMethod: "cash", status: "completed", netFils: 1142, vatFils: 58, grossFils: 1200, lines: [line("l1", 300), line("l2")] };
  const state = { products: [], categories: [], promotions: [], stockMovements: [], sales: [sale], customers: [], creditNotes: [], syncOperations: [], register: null };
  assert.equal(buildDailyReport(state, "2026-11-11").promotionSavingFils, 300);
  assert.equal(buildDailyReport(state, "2026-11-12").promotionSavingFils, 0);
});
