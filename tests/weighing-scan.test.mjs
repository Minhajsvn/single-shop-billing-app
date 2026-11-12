import assert from "node:assert/strict";
import test from "node:test";
import { scanScaleLabel } from "../lib/weighing/scan.ts";

const settings = { prefixes: ["21", "22"], codeLength: 5, value: "weight" };
const dates = { id: "d", name: "Dates", sku: "DAT", priceFils: 4000, stock: 5000, lowStockThreshold: 0, active: true, taxCategory: "standard", soldByWeight: true, scaleCode: 1234 };
const cola = { id: "c", name: "Cola", sku: "COLA", priceFils: 600, stock: 5, lowStockThreshold: 0, active: true, taxCategory: "standard" };

test("final review I2: a shop with no weighed products treats every code as an ordinary unknown code", () => {
  assert.deepEqual(scanScaleLabel("2112345000007", settings, [cola]), { kind: "none" });
  assert.deepEqual(scanScaleLabel("2101234007509", settings, [cola]), { kind: "none" }, "a bad check digit too");
  assert.deepEqual(scanScaleLabel("2101234007501", settings, [{ ...dates, active: false }, cola]), { kind: "none" }, "an archived weighed product does not count");
});

test("a shop that sells by weight gets label notices and lines", () => {
  const products = [dates, cola];
  assert.deepEqual(scanScaleLabel("6291100211014", settings, products), { kind: "none" });
  assert.deepEqual(scanScaleLabel("2101234007509", settings, products), { kind: "notice", text: "This label did not scan cleanly; scan again" });
  assert.deepEqual(scanScaleLabel("2112345007502", settings, products), { kind: "notice", text: "No weighed product with scale code 12345" });
  assert.deepEqual(scanScaleLabel("2101234007501", settings, products), { kind: "add", product: dates, grams: 750 });
  assert.deepEqual(scanScaleLabel("2101234030004", { ...settings, value: "price" }, products), { kind: "add", product: dates, grams: 750, labelPriceFils: 3000 });
  assert.deepEqual(scanScaleLabel("2101234000007", settings, products), { kind: "notice", text: "This label has no weight or price; weigh it again" });
});
