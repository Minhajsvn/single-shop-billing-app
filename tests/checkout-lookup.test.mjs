import assert from "node:assert/strict";
import test from "node:test";
import { findByCode } from "../lib/checkout/lookup.ts";

const products = [
  { id: "p1", name: "Coffee", sku: "COF-250", barcode: "6291100211014", priceFils: 2850, stock: 5, lowStockThreshold: 1, active: true },
  { id: "p2", name: "Tea", sku: "TEA-1", barcode: "6291100211021", priceFils: 1000, stock: 5, lowStockThreshold: 1, active: false },
  { id: "p3", name: "Dates", sku: "6291100211014X", priceFils: 1000, stock: 5, lowStockThreshold: 1, active: true },
];

test("scans match barcodes and SKUs exactly", () => {
  assert.equal(findByCode(products, "6291100211014")?.id, "p1");
  assert.equal(findByCode(products, " cof-250 ")?.id, "p1");
  assert.equal(findByCode(products, "62911002110")?.id, undefined, "no partial matches");
});

test("a UPC-A scan (12 digits) finds the product stored as its EAN-13 with a leading 0, and the reverse", () => {
  const upc = [
    { id: "u13", name: "Imported cable", sku: "CAB", barcode: "0712345678904", priceFils: 1500, stock: 5, lowStockThreshold: 1, active: true },
    { id: "u12", name: "Charger", sku: "CHG", barcode: "036000291452", priceFils: 4500, stock: 5, lowStockThreshold: 1, active: true },
  ];
  assert.equal(findByCode(upc, "712345678904")?.id, "u13");
  assert.equal(findByCode(upc, "0036000291452")?.id, "u12");
  assert.equal(findByCode(upc, "0712345678904")?.id, "u13");
});

test("inactive products and empty codes never match", () => {
  assert.equal(findByCode(products, "6291100211021"), null);
  assert.equal(findByCode(products, "   "), null);
});
