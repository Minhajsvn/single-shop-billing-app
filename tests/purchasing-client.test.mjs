import assert from "node:assert/strict";
import test from "node:test";
import { purchasingErrorMessage } from "../lib/purchasing/errors.ts";
import { lastDeliveries, listSuppliers, recordReceipt, voidReceipt } from "../lib/purchasing/client.ts";
import { purchasingRpcFailure } from "../lib/purchasing/route.ts";

test("refusals read in plain words, with the detail the server sends", () => {
  assert.equal(purchasingErrorMessage("stock_too_low", "Dates 1kg:5"), "Dates 1kg: only 5 left; record a correction in Inventory instead.");
  assert.equal(purchasingErrorMessage("duplicate_supplier_invoice", "2026-11-09"), "This supplier invoice is already recorded on 2026-11-09.");
  assert.equal(purchasingErrorMessage("product_archived", "Cola"), "Restore Cola first.");
  assert.equal(purchasingErrorMessage("feature_not_in_plan"), "Suppliers and deliveries are on the Pro plan.");
  assert.equal(purchasingErrorMessage("not_authorized"), "Only the owner or a manager can manage purchases.");
  assert.equal(purchasingErrorMessage("supplier_name_taken"), "A supplier with this name already exists.");
  assert.equal(purchasingErrorMessage("already_voided"), "This delivery is already voided.");
  assert.equal(purchasingErrorMessage("something"), "Something went wrong. Try again.");
});

const json = (status, body) => async () => new Response(JSON.stringify(body), { status });

test("recordReceipt posts the payload; a retry sends the identical body (same id)", async () => {
  const bodies = [];
  const payload = { id: "de000000-0000-4000-8000-000000000001", supplierId: "s", invoiceDate: "2026-11-11", vatFils: 0, lines: [{ productId: "p", quantity: 1, unitCostFils: 100 }] };
  const fetcher = async (url, init) => { bodies.push([url, init.method, init.body]); return new Response(JSON.stringify({ id: payload.id }), { status: 200 }); };
  await recordReceipt(payload, { fetch: fetcher });
  await recordReceipt(payload, { fetch: fetcher });
  assert.equal(bodies[0][0], "/api/v1/purchases");
  assert.equal(bodies[0][1], "POST");
  assert.equal(bodies[0][2], bodies[1][2]);
});

test("offline: recording says it needs a connection; other calls say purchases do", async () => {
  const offline = async () => { throw new TypeError("Failed to fetch"); };
  assert.deepEqual(await recordReceipt({ id: "x", supplierId: "s", invoiceDate: "d", vatFils: 0, lines: [] }, { fetch: offline }), { ok: false, offline: true, error: "Recording a delivery needs a connection" });
  assert.deepEqual(await listSuppliers({ fetch: offline }), { ok: false, offline: true, error: "Purchases need a connection" });
});

test("a refusal comes back with its message and detail", async () => {
  const result = await voidReceipt("r1", "x", { fetch: json(400, { code: "stock_too_low", detail: "Dates 1kg:5" }) });
  assert.deepEqual(result, { ok: false, error: "Dates 1kg: only 5 left; record a correction in Inventory instead." });
});

test("lastDeliveries returns a map by product", async () => {
  const result = await lastDeliveries({ fetch: json(200, { deliveries: [{ productId: "p1", invoiceDate: "2026-11-09", supplierName: "Al Noor", unitCostFils: 500 }] }) });
  assert.deepEqual(result, { ok: true, deliveries: new Map([["p1", { invoiceDate: "2026-11-09", supplierName: "Al Noor", unitCostFils: 500 }]]) });
});

test("server refusals: status by code, detail passed on, never cached", async () => {
  const read = async (response) => [response.status, (await response.json()).code, response.headers.get("cache-control")];
  assert.deepEqual(await read(purchasingRpcFailure("t", { code: "42501", message: "not_authorized" })), [403, "not_authorized", "no-store"]);
  assert.deepEqual(await read(purchasingRpcFailure("t", { code: "P0001", message: "feature_not_in_plan" })), [403, "feature_not_in_plan", "no-store"]);
  assert.deepEqual(await read(purchasingRpcFailure("t", { code: "P0001", message: "receipt_not_found" })), [404, "receipt_not_found", "no-store"]);
  assert.deepEqual(await read(purchasingRpcFailure("t", { code: "P0001", message: "invalid_vat" })), [400, "invalid_vat", "no-store"]);
  const withDetail = purchasingRpcFailure("t", { code: "P0001", message: "stock_too_low", details: "Dates 1kg:5" });
  assert.equal((await withDetail.json()).detail, "Dates 1kg:5");
  const original = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await read(purchasingRpcFailure("t", { code: "XX000", message: "boom" })), [500, "rpc_failed", "no-store"]);
  } finally {
    console.error = original;
  }
});
