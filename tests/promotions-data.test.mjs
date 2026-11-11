import assert from "node:assert/strict";
import test from "node:test";
import { mapSnapshotRows } from "../lib/snapshot/map-rows.ts";
import { requestSchema } from "../lib/sync/request-schema.ts";
import { normalizePromotions } from "../lib/promotions/live.ts";

const rows = {
  business: { id: "biz", legal_name: "Smoke LLC", trn: "100000000000003", address: "Dubai", phone: "+971", invoice_prefix: "SMK", receipt_footer: "Thanks", country: "AE", currency: "AED" },
  devices: [], role: "cashier", customers: [], creditNotes: [], stockMovements: [], register: null, products: [],
  sales: [{
    id: "s1", device_id: "d", invoice_number: "SMK-1", created_at: "2026-11-11T08:00:00Z", supply_date: "2026-11-11", payment_method: "cash",
    net_fils: 1715, vat_fils: 85, gross_fils: 1800, status: "completed", customer_snapshot: null, supplier_snapshot: null,
    sale_items: [{ id: "l1", product_id: "p1", description: "Cola", sku: "COLA", quantity: 3, unit_gross_fils: 600, list_unit_gross_fils: 900, net_fils: 1715, vat_fils: 85, gross_fils: 1800, promotion_id: "pr1", promotion_saving_fils: 900 }],
  }],
  promotions: [{
    id: "pr1", name: "Buy 2 get 1", kind: "multi_buy_free", target_type: "product", target_id: "p1", percent: null, amount_fils: null,
    buy_qty: 2, get_qty: 1, bundle_price_fils: null, min_basket_fils: null, starts_on: "2026-11-01", ends_on: null,
    days: [5, 6], from_time: "16:00:00", to_time: "19:00:00", active: true, archived_at: null, created_at: "2026-11-01T00:00:00Z",
  }, {
    id: "pr2", name: "Drinks 10%", kind: "percent_off", target_type: "category", target_id: "c1", percent: "10.00", amount_fils: null,
    buy_qty: null, get_qty: null, bundle_price_fils: null, min_basket_fils: "0", starts_on: "2026-11-01", ends_on: "2026-11-30",
    days: null, from_time: null, to_time: null, active: false, archived_at: null, created_at: "2026-11-02T00:00:00Z",
  }],
};

test("snapshot promotions map to the till's Promotion shape", () => {
  const { state } = mapSnapshotRows(rows, "x");
  assert.deepEqual(state.promotions[0], {
    id: "pr1", name: "Buy 2 get 1", kind: "multi_buy_free", targetType: "product", targetId: "p1", percent: null, amountFils: null,
    buyQty: 2, getQty: 1, bundlePriceFils: null, minBasketFils: null, startsOn: "2026-11-01", endsOn: null, days: [5, 6],
    fromTime: "16:00", toTime: "19:00", active: true, archived: false, createdAt: "2026-11-01T00:00:00Z",
  });
  assert.equal(state.promotions[1].percent, 10);
  assert.equal(state.promotions[1].minBasketFils, 0);
  assert.equal(state.promotions[1].active, false);
  assert.deepEqual(mapSnapshotRows({ ...rows, promotions: undefined }, "x").state.promotions, []);
});

test("sale lines keep their promotion from the server", () => {
  const line = mapSnapshotRows(rows, "x").state.sales[0].lines[0];
  assert.equal(line.promotionId, "pr1");
  assert.equal(line.promotionSavingFils, 900);
});

test("the sync payload carries a line's promotion; a negative saving is refused", () => {
  const sale = {
    id: "a1000000-0000-4000-8000-000000000001", invoiceNumber: "SMK-1", status: "completed", createdAt: "2026-11-11T08:00:00Z", supplyDate: "2026-11-11", paymentMethod: "cash",
    netFils: 1715, vatFils: 85, grossFils: 1800,
    lines: [{ id: "a1000000-0000-4000-8000-0000000000a1", name: "Cola", quantity: 3, unitGrossFils: 600, listUnitGrossFils: 900, netFils: 1715, vatFils: 85, grossFils: 1800, promotionId: "9e000000-0000-4000-8000-000000000001", promotionSavingFils: 900 }],
  };
  const op = (s) => ({ operations: [{ id: "0b000000-0000-4000-8000-000000000001", entity: "sale", entityId: sale.id, createdAt: "2026-11-11T08:00:00Z", payload: { sale: s } }] });
  const parsed = requestSchema.parse(op(sale));
  assert.equal(parsed.operations[0].payload.sale.lines[0].promotionSavingFils, 900);
  assert.equal(parsed.operations[0].payload.sale.lines[0].promotionId, "9e000000-0000-4000-8000-000000000001");
  assert.equal(requestSchema.safeParse(op({ ...sale, lines: [{ ...sale.lines[0], promotionSavingFils: -1 }] })).success, false);
});

test("saved state from before 2E has no promotions", () => {
  assert.deepEqual(normalizePromotions(undefined), []);
  assert.deepEqual(normalizePromotions("junk"), []);
  assert.equal(normalizePromotions([{ id: "x" }]).length, 1);
});
