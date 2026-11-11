import assert from "node:assert/strict";
import test from "node:test";
import { describePromotion } from "../lib/promotions/describe.ts";
import { promotionErrorMessage } from "../lib/promotions/errors.ts";
import { listPromotions, promotionResults, savePromotion } from "../lib/promotions/client.ts";
import { promotionRpcFailure } from "../lib/promotions/route.ts";
import { canUsePage, navLinksFor } from "../lib/access/cashier.ts";

const base = { id: "p", name: "x", targetType: "all", targetId: null, percent: null, amountFils: null, buyQty: null, getQty: null, bundlePriceFils: null, minBasketFils: null, startsOn: "2026-11-01", endsOn: null, days: null, fromTime: null, toTime: null, active: true, archived: false, createdAt: "x" };

test("describePromotion reads each kind in plain words", () => {
  assert.equal(describePromotion({ ...base, kind: "multi_buy_free", targetType: "product", buyQty: 2, getQty: 1, endsOn: "2026-11-30", days: [5], fromTime: "16:00", toTime: "19:00" }, "Cola 330ml"),
    "Buy 2 get 1 free on Cola 330ml · 1–30 Nov · Fri 16:00–19:00");
  assert.equal(describePromotion({ ...base, kind: "percent_off", targetType: "category", percent: 10 }, "Drinks"), "10% off Drinks · from 1 Nov");
  assert.equal(describePromotion({ ...base, kind: "basket_percent", percent: 5, minBasketFils: 20000 }, ""), "5% off bills of AED 200.00 or more · from 1 Nov");
  assert.equal(describePromotion({ ...base, kind: "amount_off", amountFils: 150 }, ""), "AED 1.50 off everything · from 1 Nov");
  assert.equal(describePromotion({ ...base, kind: "multi_buy_price", targetType: "product", buyQty: 3, bundlePriceFils: 1000, startsOn: "2026-11-25", endsOn: "2026-12-05", days: [6, 7] }, "Cola"),
    "3 for AED 10.00 on Cola · 25 Nov–5 Dec · Sat, Sun");
  assert.equal(describePromotion({ ...base, kind: "percent_off", percent: 12.5, fromTime: "22:00", toTime: "02:00" }, ""), "12.5% off everything · from 1 Nov · every day 22:00–02:00");
});

test("refusals in plain words", () => {
  assert.equal(promotionErrorMessage("feature_not_in_plan"), "Promotions are on the Pro plan.");
  assert.equal(promotionErrorMessage("not_authorized"), "Only the owner or a manager can manage promotions.");
  assert.equal(promotionErrorMessage("invalid_promotion"), "Check the promotion: the values, dates and hours must make sense.");
  assert.equal(promotionErrorMessage("target_not_found"), "That product or category is not in this shop.");
  assert.equal(promotionErrorMessage("other"), "Something went wrong. Try again.");
});

const json = (status, body) => async () => new Response(JSON.stringify(body), { status });

test("client: list, save and results; offline and refusals", async () => {
  assert.deepEqual(await listPromotions({ fetch: json(200, { promotions: [base] }) }), { ok: true, promotions: [base] });
  let sent;
  const saved = await savePromotion(base, { fetch: async (url, init) => { sent = [url, init.method]; return new Response(null, { status: 204 }); } });
  assert.deepEqual(saved, { ok: true });
  assert.deepEqual(sent, ["/api/v1/promotions", "PUT"]);
  assert.deepEqual(await savePromotion(base, { fetch: json(400, { code: "invalid_promotion" }) }), { ok: false, error: "Check the promotion: the values, dates and hours must make sense." });
  assert.deepEqual(await promotionResults("2026-11-01", "2026-11-11", { fetch: async () => { throw new TypeError("x"); } }), { ok: false, offline: true, error: "Promotions need a connection" });
});

test("server refusals map to status codes and are never cached", async () => {
  const read = async (response) => [response.status, (await response.json()).code, response.headers.get("cache-control")];
  assert.deepEqual(await read(promotionRpcFailure("t", { code: "42501", message: "not_authorized" })), [403, "not_authorized", "no-store"]);
  assert.deepEqual(await read(promotionRpcFailure("t", { code: "P0001", message: "target_not_found" })), [404, "target_not_found", "no-store"]);
  assert.deepEqual(await read(promotionRpcFailure("t", { code: "P0001", message: "invalid_promotion" })), [400, "invalid_promotion", "no-store"]);
});

test("access: owner and manager open Promotions; cashier does not; nav order", () => {
  assert.equal(canUsePage("manager", "/promotions"), true);
  assert.equal(canUsePage("cashier", "/promotions"), false);
  assert.deepEqual(navLinksFor("owner").map((link) => link.href), ["/overview", "/sale", "/sales", "/inventory", "/purchases", "/promotions", "/customers", "/register", "/reports", "/settings"]);
  assert.deepEqual(navLinksFor("manager").map((link) => link.href), ["/overview", "/sale", "/sales", "/inventory", "/purchases", "/promotions", "/customers", "/register", "/reports", "/settings?tab=data"]);
});
