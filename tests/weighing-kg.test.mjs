import assert from "node:assert/strict";
import test from "node:test";
import { findByCode, findWeighedByScaleCode } from "../lib/checkout/lookup.ts";
import { formatKg, formatStock, gramsForPrice, parseKgInput, perKgText, priceForGrams, weighedLineText } from "../lib/weighing/kg.ts";

const plain = (text) => text.replace(/ /g, " ");

test("kg input becomes grams: 0.001 to 100 kg, up to 3 decimals", () => {
  assert.equal(parseKgInput("0.75"), 750);
  assert.equal(parseKgInput(" 1.5 "), 1500);
  assert.equal(parseKgInput("0.001"), 1);
  assert.equal(parseKgInput("100"), 100000);
  assert.equal(parseKgInput("1.2345"), null);
  assert.equal(parseKgInput("0"), null);
  assert.equal(parseKgInput("100.001"), null);
  assert.equal(parseKgInput("abc"), null);
  assert.equal(parseKgInput(""), null);
});

test("price for grams and grams for price round to whole fils and grams, never zero", () => {
  assert.equal(priceForGrams(4000, 750), 3000);
  assert.equal(priceForGrams(4000, 1), 4);
  assert.equal(priceForGrams(1, 1), 1);
  assert.equal(gramsForPrice(3000, 4000), 750);
  assert.equal(gramsForPrice(1, 400000), 1);
});

test("kg text", () => {
  assert.equal(formatKg(4250), "4.250 kg");
  assert.equal(formatKg(1), "0.001 kg");
  assert.equal(plain(perKgText(4000)), "AED 40.00/kg");
  assert.equal(plain(weighedLineText(750, 4000)), "0.750 kg × AED 40.00/kg");
  assert.equal(formatStock({ stock: 4250, soldByWeight: true }), "4.250 kg");
  assert.equal(formatStock({ stock: 12 }), "12");
});

const products = [
  { id: "w1", name: "Dates", sku: "DATES", priceFils: 4000, stock: 5000, lowStockThreshold: 0, active: true, taxCategory: "standard", soldByWeight: true, scaleCode: 1234 },
  { id: "w2", name: "Old nuts", sku: "NUTS", priceFils: 4000, stock: 0, lowStockThreshold: 0, active: false, taxCategory: "standard", soldByWeight: true, scaleCode: 55 },
  { id: "p1", name: "Cola", sku: "COLA", barcode: "2212345678907", priceFils: 600, stock: 5, lowStockThreshold: 0, active: true, taxCategory: "standard", scaleCode: 77 },
];

test("weighed products are found by scale code: active and sold by weight only", () => {
  assert.equal(findWeighedByScaleCode(products, 1234)?.id, "w1");
  assert.equal(findWeighedByScaleCode(products, 55), null, "inactive");
  assert.equal(findWeighedByScaleCode(products, 77), null, "not sold by weight");
});

test("an ordinary barcode that starts with a scale prefix still finds its product", () => {
  assert.equal(findByCode(products, "2212345678907")?.id, "p1");
});
