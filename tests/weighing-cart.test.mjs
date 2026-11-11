import assert from "node:assert/strict";
import test from "node:test";
import { formatItemCount } from "../lib/checkout/pricing.ts";
import { cartUsage, weighedLine } from "../lib/weighing/cart.ts";

const dates = { id: "p-dates", name: "Dates", sku: "DAT", priceFils: 4000, stock: 5000, lowStockThreshold: 0, active: true, taxCategory: "standard", soldByWeight: true, scaleCode: 1234 };

test("cart usage counts grams for weighed lines and units for the rest", () => {
  const lines = [
    { productId: "p-dates", quantity: 1, weightGrams: 750 },
    { productId: "p-dates", quantity: 1, weightGrams: 500 },
    { productId: "p-cola", quantity: 3 },
  ];
  assert.equal(cartUsage(lines, "p-dates"), 1250);
  assert.equal(cartUsage(lines, "p-cola"), 3);
  assert.equal(cartUsage(lines, "p-none"), 0);
});

test("a weighed line is quantity 1 at the price for its grams, with a fresh key each time", () => {
  const first = weighedLine(dates, 750);
  const second = weighedLine(dates, 750);
  assert.deepEqual({ ...first, key: "k" }, { key: "k", productId: "p-dates", name: "Dates", sku: "DAT", quantity: 1, unitGrossFils: 3000, weightGrams: 750, pricePerKgFils: 4000 });
  assert.notEqual(first.key, second.key);
  assert.equal(weighedLine(dates, 750, 2990).unitGrossFils, 2990, "a price label's own price wins");
});

test("a weighed line counts as one item", () => {
  assert.equal(formatItemCount([{ quantity: 1, weightGrams: 750 }, { quantity: 2 }]), "3 items");
});
