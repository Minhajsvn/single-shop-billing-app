import assert from "node:assert/strict";
import test from "node:test";
import { canUsePage, navLinksFor } from "../lib/access/cashier.ts";
import { mergeSnapshot } from "../lib/snapshot/merge.ts";

test("canUsePage: a cashier is kept to the selling pages and the Data tab of Settings", () => {
  assert.equal(canUsePage("cashier", "/reports"), false);
  assert.equal(canUsePage("cashier", "/reports/vat"), false);
  assert.equal(canUsePage("cashier", "/settings", "data"), true);
  assert.equal(canUsePage("cashier", "/settings", "billing"), false);
  assert.equal(canUsePage("cashier", "/settings", "business"), false);
  assert.equal(canUsePage("cashier", "/settings", "tills"), false);
  assert.equal(canUsePage("cashier", "/settings", "tax"), false);
  assert.equal(canUsePage("cashier", "/sale"), true);
  for (const path of ["/overview", "/sales", "/sales/5b0c7a1e-0000-4000-8000-000000000001", "/inventory", "/customers", "/register"]) {
    assert.equal(canUsePage("cashier", path), true, path);
  }
  // "/sales" must not open "/salesreport" by prefix.
  assert.equal(canUsePage("cashier", "/salesreport"), false);
});

test("canUsePage: a manager has the cashier's pages; an owner (and the sample shop) has every page", () => {
  assert.equal(canUsePage("manager", "/reports"), false);
  for (const [path, tab] of [["/reports", null], ["/settings", "billing"], ["/settings", "business"], ["/settings", "data"], ["/sale", null], ["/inventory", null]]) {
    assert.equal(canUsePage("owner", path, tab), true, `${path} ${tab}`);
  }
  // Before the first snapshot the role is unknown: nothing is blocked (the server checks every write anyway).
  assert.equal(canUsePage(null, "/reports"), true);
});

test("navLinksFor: the cashier's exact links", () => {
  assert.deepEqual(navLinksFor("cashier"), [
    { href: "/overview", label: "Overview" },
    { href: "/sale", label: "New sale" },
    { href: "/sales", label: "Sales" },
    { href: "/inventory", label: "Inventory" },
    { href: "/customers", label: "Customers" },
    { href: "/register", label: "Register" },
    { href: "/settings?tab=data", label: "Settings" },
  ]);
});

test("navLinksFor: the owner keeps Reports and all of Settings", () => {
  assert.deepEqual(navLinksFor("owner").map((link) => link.href), ["/overview", "/sale", "/sales", "/inventory", "/customers", "/register", "/reports", "/settings"]);
  assert.deepEqual(navLinksFor(null).map((link) => link.href), navLinksFor("owner").map((link) => link.href));
});

const line = { id: "l1", productId: "p1", name: "Coffee", sku: "COF", quantity: 1, unitGrossFils: 2850, netFils: 2714, vatFils: 136, grossFils: 2850 };
const sale = (id, supplyDate, createdAt) => ({ id, invoiceNumber: `SMK-1-${id}`, createdAt, supplyDate, paymentMethod: "cash", lines: [line], netFils: 2714, vatFils: 136, grossFils: 2850, status: "completed" });
const empty = { products: [], stockMovements: [], sales: [], customers: [], creditNotes: [], syncOperations: [], register: null };

test("cashier snapshot keeps unsynced local sales (Review Focus 5)", () => {
  const product = { id: "p1", name: "Coffee", sku: "COF", priceFils: 2850, stock: 9, lowStockThreshold: 2, active: true, taxCategory: "standard" };
  // Yesterday's sale was rung up offline and never synced; an older one synced long ago.
  const unsynced = sale("s-unsynced", "2026-10-20", "2026-10-20T18:00:00Z");
  const synced = sale("s-synced", "2026-10-01", "2026-10-01T09:00:00Z");
  const local = {
    ...empty,
    products: [{ ...product, stock: 8 }],
    sales: [unsynced, synced],
    syncOperations: [
      { id: "op-1", entity: "sale", entityId: unsynced.id, createdAt: unsynced.createdAt, status: "pending", payload: { sale: unsynced } },
      { id: "op-2", entity: "sale", entityId: synced.id, createdAt: synced.createdAt, status: "synced", payload: { sale: synced } },
    ],
  };
  // A cashier's snapshot: products and today's (empty) sales only; no old sales, no stock movements.
  const cashierSnapshot = { ...empty, products: [product] };
  const merged = mergeSnapshot(cashierSnapshot, local);
  assert.deepEqual(merged.sales.map((item) => item.id), ["s-unsynced"], "the unsynced sale stays; the synced one is the server's to show");
  assert.equal(merged.syncOperations.length, 1);
  assert.equal(merged.syncOperations[0].id, "op-1");
  assert.equal(merged.products[0].stock, 8, "the unsynced sale still holds its stock");
});

test("cashier snapshot keeps an unsynced refund of an old sale the snapshot does not hold", () => {
  const note = { id: "cn-1", creditNoteNumber: "CN-1", saleId: "s-old", invoiceNumber: "SMK-1-s-old", createdAt: "2026-10-21T08:00:00Z", paymentMethod: "cash", lines: [{ ...line, id: "cl1", originalLineId: "l1" }], netFils: 2714, vatFils: 136, grossFils: 2850 };
  const local = { ...empty, creditNotes: [note], syncOperations: [{ id: "op-cn", entity: "credit-note", entityId: note.id, createdAt: note.createdAt, status: "pending", payload: { creditNote: note } }] };
  const merged = mergeSnapshot({ ...empty, products: [{ id: "p1", name: "Coffee", sku: "COF", priceFils: 2850, stock: 5, lowStockThreshold: 2, active: true }] }, local);
  assert.deepEqual(merged.creditNotes.map((item) => item.id), ["cn-1"]);
  assert.equal(merged.products[0].stock, 6);
});

test("a synced refund of an old sale keeps its invoice number when the cashier's snapshot cannot see that sale", () => {
  const note = { id: "cn-1", creditNoteNumber: "CN-1", saleId: "s-old", invoiceNumber: "SMK-1-260801-0001", createdAt: "2026-10-21T08:00:00Z", paymentMethod: "cash", lines: [], netFils: 0, vatFils: 0, grossFils: 0 };
  // Row security hides the old sale, so the server's copy of the credit note carries no invoice number.
  const merged = mergeSnapshot({ ...empty, creditNotes: [{ ...note, invoiceNumber: "" }] }, { ...empty, creditNotes: [note] });
  assert.equal(merged.creditNotes[0].invoiceNumber, "SMK-1-260801-0001");
});

test("refund by invoice number: the field shows for every role in a hosted shop", async () => {
  const { refundByInvoiceShown } = await import("../lib/sales/invoice-lookup.ts");
  // The rule takes no role: owner, manager and cashier alike get the field in a hosted shop.
  assert.equal(refundByInvoiceShown.length, 1);
  assert.equal(refundByInvoiceShown("hosted"), true);
  assert.equal(refundByInvoiceShown("sample"), false);
  assert.equal(refundByInvoiceShown("unconfigured"), false);
});

test("remoteSaleSource: ?invoice= finds and refunds for any role; an owner opening an old sale by id stays view-only", async () => {
  const { remoteSaleSource, remoteSaleRefundable } = await import("../lib/sales/invoice-lookup.ts");
  assert.equal(remoteSaleSource({ hasLocal: true, ownerView: true, hasInvoiceParam: true }), "none");
  assert.equal(remoteSaleSource({ hasLocal: false, ownerView: true, hasInvoiceParam: true }), "by-invoice");
  assert.equal(remoteSaleSource({ hasLocal: false, ownerView: false, hasInvoiceParam: true }), "by-invoice");
  assert.equal(remoteSaleSource({ hasLocal: false, ownerView: true, hasInvoiceParam: false }), "by-id");
  // A cashier cannot use the owner-only by-id route; without an invoice number the sale is simply not found.
  assert.equal(remoteSaleSource({ hasLocal: false, ownerView: false, hasInvoiceParam: false }), "by-invoice");
  assert.equal(remoteSaleRefundable("by-invoice"), true);
  assert.equal(remoteSaleRefundable("by-id"), false);
});

test("refundedQuantities: local and server credit notes count once each", async () => {
  const { refundedQuantities } = await import("../lib/sales/invoice-lookup.ts");
  const local = [
    { id: "cn-synced", saleId: "s1", lines: [{ originalLineId: "l1", quantity: 1 }] },
    { id: "cn-pending", saleId: "s1", lines: [{ originalLineId: "l2", quantity: 2 }] },
    { id: "cn-other", saleId: "s2", lines: [{ originalLineId: "l1", quantity: 5 }] },
  ];
  const server = [
    { id: "cn-synced", lines: [{ saleItemId: "l1", quantity: 1 }] },
    { id: "cn-elsewhere", lines: [{ saleItemId: "l1", quantity: 3 }] },
  ];
  const quantities = refundedQuantities("s1", local, server);
  assert.equal(quantities.get("l1"), 4);
  assert.equal(quantities.get("l2"), 2);
});
