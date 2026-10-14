import assert from "node:assert/strict";
import test from "node:test";
import { mapSnapshotRows } from "../lib/snapshot/map-rows.ts";

const rows = {
  business: { id: "biz", legal_name: "Smoke LLC", trn: "100000000000003", address: "Dubai", phone: "+971", invoice_prefix: "SMK", receipt_footer: "Thanks", country: "AE", currency: "AED" },
  devices: [
    { id: "dev-2", name: "Counter 2", till_number: 2, branch_id: "br", status: "active" },
    { id: "dev-1", name: "Counter 1", till_number: 1, branch_id: "br", status: "active" },
  ],
  products: [{ id: "p1", name: "Coffee", sku: "COF", barcode: null, price_fils: 2850, stock_quantity: 4, low_stock_threshold: 5, status: "active" }],
  customers: [{ id: "c1", name: "Omar", phone: "+971 55", email: null, address: null, trn: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z" }],
  sales: [{
    id: "s1", invoice_number: "SMK-1-261013-0001", created_at: "2026-10-13T08:00:00Z", supply_date: "2026-10-13", payment_method: "cash",
    net_fils: 2714, vat_fils: 136, gross_fils: 2850, status: "completed",
    customer_snapshot: null, supplier_snapshot: { name: "Smoke LLC", trn: "100000000000003", address: "Dubai", phone: "+971" },
    sale_items: [{ id: "l1", product_id: "p1", description: "Coffee", sku: "COF", quantity: 1, unit_gross_fils: 2850, net_fils: 2714, vat_fils: 136, gross_fils: 2850 }],
  }],
  creditNotes: [{
    id: "n1", credit_note_number: "CN-1-261013-0001", sale_id: "s1", payment_method: "cash", created_at: "2026-10-13T09:00:00Z",
    sales: { invoice_number: "SMK-1-261013-0001" },
    net_fils: 2714, vat_fils: 136, gross_fils: 2850,
    credit_note_items: [{ id: "nl1", sale_item_id: "l1", product_id: "p1", description: "Coffee", sku: "COF", quantity: 1, unit_gross_fils: 2850, net_fils: 2714, vat_fils: 136, gross_fils: 2850 }],
  }],
  stockMovements: [{ id: "m1", product_id: "p1", type: "correction_out", quantity_delta: -1, reason: "Broken", created_at: "2026-10-13T07:00:00Z" }],
  register: {
    id: "r1", status: "open", opened_at: "2026-10-13T04:00:00Z", opening_cash_fils: 24000, closed_at: null, counted_cash_fils: null, expected_cash_fils: null, variance_fils: null,
    cash_movements: [
      { id: "a1", type: "adjustment_out", amount_fils: -500, reason: "Petty cash", created_at: "2026-10-13T05:00:00Z" },
      { id: "x1", type: "sale", amount_fils: 2850, reason: "SMK-1-261013-0001", created_at: "2026-10-13T08:00:00Z" },
    ],
  },
};

test("maps business, devices sorted by till number", () => {
  const s = mapSnapshotRows(rows, "2026-10-13T10:00:00Z");
  assert.equal(s.business.invoicePrefix, "SMK");
  assert.deepEqual(s.devices.map((d) => d.tillNumber), [1, 2]);
});

test("maps products, customers and sales with lines and supplier", () => {
  const { state } = mapSnapshotRows(rows, "x");
  assert.deepEqual(state.products[0], { id: "p1", name: "Coffee", sku: "COF", barcode: undefined, priceFils: 2850, stock: 4, lowStockThreshold: 5, active: true });
  assert.equal(state.customers[0].email, undefined);
  assert.equal(state.sales[0].lines[0].productId, "p1");
  assert.equal(state.sales[0].supplier?.name, "Smoke LLC");
  assert.equal(state.sales[0].customer, undefined);
});

test("credit notes link to the original line and invoice number", () => {
  const { state } = mapSnapshotRows(rows, "x");
  assert.equal(state.creditNotes[0].invoiceNumber, "SMK-1-261013-0001");
  assert.equal(state.creditNotes[0].lines[0].originalLineId, "l1");
});

test("a credit note whose sale is outside the window keeps its invoice number", () => {
  const { state } = mapSnapshotRows({ ...rows, sales: [], creditNotes: [{ ...rows.creditNotes[0], sale_id: "old-sale", sales: { invoice_number: "SMK-1-250101-0007" } }] }, "x");
  assert.equal(state.creditNotes[0].invoiceNumber, "SMK-1-250101-0007");
});

test("stock movement types use the client's hyphenated names", () => {
  assert.equal(mapSnapshotRows(rows, "x").state.stockMovements[0].type, "correction-out");
});

test("register keeps only manual adjustments, signed", () => {
  const register = mapSnapshotRows(rows, "x").state.register;
  assert.equal(register?.status, "open");
  assert.deepEqual(register?.adjustments.map((a) => a.amountFils), [-500]);
});

test("no register row means no register; sync outbox always starts empty", () => {
  const s = mapSnapshotRows({ ...rows, register: null }, "x");
  assert.equal(s.state.register, null);
  assert.deepEqual(s.state.syncOperations, []);
});
