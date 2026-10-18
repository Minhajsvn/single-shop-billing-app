import assert from "node:assert/strict";
import test from "node:test";
import { EXPORT_HEADINGS, guessMapping } from "../lib/catalogue/columns.ts";
import { parseBarcodeCell, parsePriceCell, parseStockCell, parseTaxCategoryCell, parseTextCell, parseThresholdCell } from "../lib/catalogue/parse.ts";

test("price accepts plain, AED-labelled, thousands and numeric cells", () => {
  for (const [cell, fils] of [["12", 1200], ["12.5", 1250], ["AED 12.50", 1250], ["12.50 AED", 1250], ["1,234.50", 123450], [12.5, 1250], [28.499999999, 2850]]) {
    assert.deepEqual(parsePriceCell(cell), { ok: true, value: fils }, String(cell));
  }
});

test("price rejects ambiguous, over-precise, zero, negative and text", () => {
  for (const cell of ["12,50", "12.505", "0", "-3", "AED twelve", "—", "", null, 12.345, 0]) {
    assert.equal(parsePriceCell(cell).ok, false, String(cell));
  }
});

test("stock is a whole number ≥ 0 or blank", () => {
  assert.deepEqual(parseStockCell(40), { ok: true, value: 40 });
  assert.deepEqual(parseStockCell("40.0"), { ok: true, value: 40 });
  assert.deepEqual(parseStockCell(""), { ok: true, value: null });
  assert.deepEqual(parseStockCell(null), { ok: true, value: null });
  for (const cell of [4.5, "-1", "lots"]) assert.equal(parseStockCell(cell).ok, false, String(cell));
});

test("low-stock threshold follows the stock rules", () => {
  assert.deepEqual(parseThresholdCell("3"), { ok: true, value: 3 });
  assert.deepEqual(parseThresholdCell(""), { ok: true, value: null });
  assert.equal(parseThresholdCell("2.5").ok, false);
});

test("numeric barcode cells become exact digits; a 12-digit cell that is an EAN-13 with a lost leading 0 is restored", () => {
  assert.deepEqual(parseBarcodeCell(6291100211014), { ok: true, value: "6291100211014" });
  assert.deepEqual(parseBarcodeCell(" 0012345 "), { ok: true, value: "0012345" });
  assert.deepEqual(parseBarcodeCell(""), { ok: true, value: null });
  assert.deepEqual(parseBarcodeCell(12345678905), { ok: true, value: "12345678905" }); // 11 digits: unchanged
  assert.deepEqual(parseBarcodeCell(735000000001), { ok: true, value: "0735000000001" }); // 12 digits, "0…" is a valid EAN-13
  assert.deepEqual(parseBarcodeCell(735000000000), { ok: true, value: "735000000000" }); // padding gives an invalid EAN-13: unchanged
  assert.deepEqual(parseBarcodeCell("735000000001"), { ok: true, value: "735000000001" }); // text cells are never padded
});

test('export-style ="digits" barcode cells are unwrapped', () => {
  assert.deepEqual(parseBarcodeCell('="6291100211014"'), { ok: true, value: "6291100211014" });
});

test("barcode longer than 100 characters is a problem; exponent text is a problem", () => {
  assert.equal(parseBarcodeCell("9".repeat(101)).ok, false);
  assert.equal(parseBarcodeCell("6.29E+12").ok, false);
});

test("VAT category reads clear words only", () => {
  for (const [cell, value] of [["Standard", "standard"], ["5%", "standard"], ["zero-rated", "zero"], ["0%", "zero"], ["Exempt", "exempt"], ["", null]]) {
    assert.deepEqual(parseTaxCategoryCell(cell), { ok: true, value }, String(cell));
  }
  assert.equal(parseTaxCategoryCell("maybe").ok, false);
});

test("text cells are trimmed, keep Arabic, and reject over-long values", () => {
  assert.deepEqual(parseTextCell("  ماء  ", 160), { ok: true, value: "ماء" });
  assert.deepEqual(parseTextCell("", 160), { ok: true, value: null });
  assert.deepEqual(parseTextCell("x".repeat(161), 160), { ok: false, reason: "Name is longer than 160 characters" });
});

test("guessMapping recognises English and Arabic headings and export headings", () => {
  assert.deepEqual(guessMapping(["Item Name", "Barcode", "Selling Price", "Qty"]), { name: 0, barcode: 1, price: 2, stock: 3 });
  assert.deepEqual(guessMapping(["اسم", "باركود", "سعر", "كمية"]), { name: 0, barcode: 1, price: 2, stock: 3 });
  assert.deepEqual(guessMapping(EXPORT_HEADINGS), { name: 0, sku: 1, barcode: 2, price: 3, stock: 4, lowStock: 5, taxCategory: 6 });
});
