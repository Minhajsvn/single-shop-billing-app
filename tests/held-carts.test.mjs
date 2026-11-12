import assert from "node:assert/strict";
import test from "node:test";
import { MAX_HELD_CARTS, heldCartsKey, holdCart, resumeCart } from "../lib/checkout/held-carts.ts";

const now = new Date("2026-10-15T10:00:00Z");
const product = (id, stock, active = true) => ({ id, name: id, sku: id, priceFils: 1000, stock, lowStockThreshold: 0, active });
const line = (productId, quantity) => ({ productId, name: productId, sku: productId, quantity, unitGrossFils: 1000 });

test("held carts are keyed per till", () => {
  assert.equal(heldCartsKey("dev-1"), "shop-ledger-held-carts-v1:dev-1");
  assert.equal(heldCartsKey(null), "shop-ledger-held-carts-v1:local");
});

test("holding adds newest first and refuses empty carts and the 11th cart", () => {
  const first = holdCart([], { lines: [line("a", 1)] }, "h1", now);
  assert.equal(first.ok && first.list[0].id, "h1");
  assert.equal(holdCart([], { lines: [] }, "h0", now).ok, false);
  const full = Array.from({ length: MAX_HELD_CARTS }, (_, index) => ({ id: `h${index}`, heldAt: now.toISOString(), lines: [line("a", 1)] }));
  assert.equal(holdCart(full, { lines: [line("a", 1)] }, "h99", now).ok, false);
});

test("resuming removes the cart from the list and caps lines at current stock", () => {
  const list = [{ id: "h1", heldAt: now.toISOString(), lines: [line("a", 5), line("b", 1), line("gone", 1), { name: "Gift wrap", quantity: 1, unitGrossFils: 500 }] }];
  const result = resumeCart(list, "h1", [product("a", 2), product("b", 0)]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.list, []);
  assert.deepEqual(result.cart.lines.map((item) => [item.name, item.quantity]), [["a", 2], ["Gift wrap", 1]]);
  assert.equal(result.notices.length, 3, "capped a, dropped b (out of stock) and gone (missing)");
});

test("resuming an unknown cart fails", () => {
  assert.equal(resumeCart([], "nope", []).ok, false);
});

test("Stage 2F: weighed held lines keep their grams and check them against stock in grams; older lines are unchanged", () => {
  const dates = { ...product("dates", 600), soldByWeight: true };
  const weighed = { productId: "dates", name: "dates", sku: "dates", quantity: 1, unitGrossFils: 3000, weightGrams: 750, pricePerKgFils: 4000 };
  const small = { ...weighed, unitGrossFils: 2000, weightGrams: 500 };
  const list = [{ id: "h1", heldAt: now.toISOString(), lines: [weighed, small, line("a", 1)] }];
  const result = resumeCart(list, "h1", [dates, product("a", 2)]);
  assert.deepEqual(result.cart.lines.map((item) => [item.name, item.weightGrams, item.pricePerKgFils]), [["dates", 500, 4000], ["a", undefined, undefined]]);
  assert.equal(result.notices.length, 1, "the 750 g line no longer fits in 600 g");
  // A product switched to (or from) sold-by-weight since the hold: its lines are dropped with a notice.
  const switched = resumeCart([{ id: "h2", heldAt: now.toISOString(), lines: [line("dates", 1), { ...weighed, productId: "a" }] }], "h2", [dates, product("a", 2)]);
  assert.deepEqual(switched.cart.lines, []);
  assert.equal(switched.notices.length, 2);
});
