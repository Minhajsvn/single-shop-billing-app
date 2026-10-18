import assert from "node:assert/strict";
import test from "node:test";
import { barcodeFor, code128Modules, ean13Modules, isValidEan13 } from "../lib/catalogue/barcode.ts";

test("EAN-13 check digit", () => {
  assert.equal(isValidEan13("4006381333931"), true);
  assert.equal(isValidEan13("6291100211014"), false);
  assert.equal(isValidEan13("6291100211012"), true);
  assert.equal(isValidEan13("400638133393"), false);
});

test("EAN-13 modules: guards, first-digit parity and right half", () => {
  const modules = ean13Modules("4006381333931");
  assert.equal(modules.length, 95);
  assert.match(modules, /^[01]+$/);
  assert.equal(modules.slice(0, 3), "101");
  assert.equal(modules.slice(3, 10), "0001101"); // "0" in L (leading digit 4 → L G L L G G)
  assert.equal(modules.slice(10, 17), "0100111"); // "0" in G
  assert.equal(modules.slice(45, 50), "01010");
  assert.equal(modules.slice(50, 57), "1000010"); // "3" in R
  assert.equal(modules.slice(92), "101");
  assert.throws(() => ean13Modules("6291100211014"), RangeError);
});

test("Code 128B modules for ABC", () => {
  const modules = code128Modules("ABC");
  assert.equal(modules.length, 68);
  assert.equal(modules.slice(0, 11), "11010010000"); // Start B
  assert.equal(modules.slice(44, 55), "11001101100"); // check value (104 + 33 + 68 + 105) % 103 = 1
  assert.equal(modules.slice(55), "1100011101011"); // Stop
  assert.throws(() => code128Modules("é"), RangeError);
  assert.throws(() => code128Modules(""), RangeError);
});

test("barcodeFor returns null (never throws) for codes Code 128 cannot print", () => {
  assert.equal(barcodeFor({ sku: "مياه" }), null);
  assert.equal(barcodeFor({ sku: "ABC 123" }), null);
  assert.equal(barcodeFor({ barcode: "ABC 123", sku: "OK-1" }), null);
});

test("barcodeFor picks EAN-13 for valid codes, else Code 128 of the barcode or the SKU", () => {
  assert.equal(barcodeFor({ barcode: "4006381333931", sku: "X" }).symbology, "ean13");
  const invalid = barcodeFor({ barcode: "6291100211014", sku: "X" });
  assert.deepEqual([invalid.symbology, invalid.value], ["code128", "6291100211014"]);
  const sku = barcodeFor({ sku: "P-0001" });
  assert.deepEqual([sku.symbology, sku.value], ["code128", "P-0001"]);
  assert.equal(sku.modules, code128Modules("P-0001"));
});
