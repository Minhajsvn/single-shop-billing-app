import assert from "node:assert/strict";
import test from "node:test";
import { profitErrorMessage } from "../lib/profit/errors.ts";
import { fetchProductCosts, fetchProfitReport, saveProductCost } from "../lib/profit/client.ts";

test("every refusal code reads in plain words", () => {
  assert.equal(profitErrorMessage("feature_not_in_plan"), "Cost and profit are on the Pro plan.");
  assert.equal(profitErrorMessage("not_authorized"), "Only the owner or a manager can see cost and profit.");
  assert.equal(profitErrorMessage("product_not_found"), "Saved. The cost will save once this product has synced; open it again to retry.");
  assert.equal(profitErrorMessage("invalid_cost"), "Enter a cost between 0 and 1,000,000 AED.");
  assert.equal(profitErrorMessage("invalid_range"), "Choose a period within 92 days.");
  assert.equal(profitErrorMessage("something_else"), "Something went wrong. Try again.");
});

const reply = (status, body) => async () => new Response(body === undefined ? null : JSON.stringify(body), { status });

test("saveProductCost syncs first, then puts the cost; a refusal comes back in plain words", async () => {
  const calls = [];
  const ok = await saveProductCost("p1", 1250, {
    reconcile: async () => { calls.push("sync"); },
    fetch: async (url, init) => { calls.push(`${init.method} ${url} ${init.body}`); return new Response(null, { status: 204 }); },
  });
  assert.deepEqual(ok, { ok: true });
  assert.deepEqual(calls, ["sync", 'PUT /api/v1/products/p1/cost {"costFils":1250}']);

  const refused = await saveProductCost("p1", 1250, { reconcile: async () => {}, fetch: reply(404, { error: "x", code: "product_not_found" }) });
  assert.deepEqual(refused, { ok: false, error: "Saved. The cost will save once this product has synced; open it again to retry." });
});

test("saveProductCost offline says the cost needs a connection, even when the sync step fails", async () => {
  const result = await saveProductCost("p1", null, { reconcile: async () => { throw new Error("offline"); }, fetch: async () => { throw new TypeError("Failed to fetch"); } });
  assert.deepEqual(result, { ok: false, error: "Cost needs a connection" });
});

test("fetchProductCosts returns a map; a refusal is an error", async () => {
  const costs = await fetchProductCosts({ fetch: reply(200, { costs: [{ productId: "p1", costFils: 1000 }, { productId: "p2", costFils: 0 }] }) });
  assert.deepEqual(costs, { ok: true, costs: new Map([["p1", 1000], ["p2", 0]]) });
  assert.deepEqual(await fetchProductCosts({ fetch: reply(403, { code: "feature_not_in_plan" }) }), { ok: false, error: "Cost and profit are on the Pro plan." });
});

test("fetchProfitReport: offline is flagged, a report comes back as is", async () => {
  assert.deepEqual(await fetchProfitReport("2026-11-01", "2026-11-10", { fetch: async () => { throw new TypeError("Failed to fetch"); } }),
    { ok: false, offline: true, error: "Profit needs a connection" });
  const report = { totals: { netFils: 1 }, byDay: [], byCategory: [], byProduct: [] };
  let asked = "";
  const result = await fetchProfitReport("2026-11-01", "2026-11-10", { fetch: async (url) => { asked = url; return new Response(JSON.stringify(report), { status: 200 }); } });
  assert.equal(asked, "/api/v1/reports/profit?from=2026-11-01&to=2026-11-10");
  assert.deepEqual(result, { ok: true, report });
});

test("server refusals: 42501 is not_authorized (403), our P0001 codes keep their status, anything else is a 500", async () => {
  const { profitRpcFailure } = await import("../lib/profit/route.ts");
  const read = async (response) => [response.status, (await response.json()).code, response.headers.get("cache-control")];
  assert.deepEqual(await read(profitRpcFailure("t", { code: "42501", message: "not_authorized" })), [403, "not_authorized", "no-store"]);
  assert.deepEqual(await read(profitRpcFailure("t", { code: "P0001", message: "feature_not_in_plan" })), [403, "feature_not_in_plan", "no-store"]);
  assert.deepEqual(await read(profitRpcFailure("t", { code: "P0001", message: "product_not_found" })), [404, "product_not_found", "no-store"]);
  assert.deepEqual(await read(profitRpcFailure("t", { code: "P0001", message: "invalid_range" })), [400, "invalid_range", "no-store"]);
  const original = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await read(profitRpcFailure("t", { code: "XX000", message: "boom" })), [500, "rpc_failed", "no-store"]);
  } finally {
    console.error = original;
  }
});
