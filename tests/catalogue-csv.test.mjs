import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv, problemsToCsv, productsToCsv, toCsv } from "../lib/catalogue/csv.ts";

const water = { id: "w", name: "Water", sku: "WAT-6", barcode: "6291100211014", priceFils: 2850, stock: 10, lowStockThreshold: 5, active: true, taxCategory: "standard" };

test("parseCsv handles BOM, CRLF and LF, quoted commas and escaped quotes", () => {
  assert.deepEqual(parseCsv('﻿Name,Price\r\n"Tea, green",12.50\n"Say ""hi""",3'), [["Name", "Price"], ["Tea, green", "12.50"], ['Say "hi"', "3"]]);
});

test("parseCsv keeps quoted newlines and ignores a trailing newline", () => {
  assert.deepEqual(parseCsv('a,b\n"line1\nline2",x\n'), [["a", "b"], ["line1\nline2", "x"]]);
});

test("toCsv starts with a BOM, uses CRLF and quotes only when needed", () => {
  const csv = toCsv([["Name", "Note"], ["Tea, green", 'say "hi"'], ["Plain", 3]]);
  assert.ok(csv.startsWith("﻿"));
  assert.equal(csv, '﻿Name,Note\r\n"Tea, green","say ""hi"""\r\nPlain,3\r\n');
});

test("productsToCsv writes the export layout with Excel-safe barcodes", () => {
  const csv = productsToCsv([water, { ...water, id: "x", name: "Old", sku: "OLD", barcode: undefined, active: false, taxCategory: "zero", priceFils: 500 }]);
  const [head, first, second] = parseCsv(csv);
  assert.deepEqual(head, ["Name", "SKU", "Barcode", "Price (AED)", "Stock", "Low-stock threshold", "VAT category", "Status"]);
  assert.ok(csv.includes('"=""6291100211014"""'));
  assert.deepEqual(first, ["Water", "WAT-6", '="6291100211014"', "28.50", "10", "5", "Standard", "Active"]);
  assert.deepEqual(second, ["Old", "OLD", "", "5.00", "10", "5", "Zero-rated", "Archived"]);
});

test("Arabic names survive export and re-read", () => {
  const [, row] = parseCsv(productsToCsv([{ ...water, name: "مياه العين" }]));
  assert.equal(row[0], "مياه العين");
});

test("problemsToCsv keeps the original columns and adds a Problem column", () => {
  const csv = problemsToCsv(["Name", "Price"], [{ rowNumber: 3, cells: ["Tea", "12,50"], reasons: ["Price is unclear", "Stock is bad"] }]);
  assert.deepEqual(parseCsv(csv), [["Name", "Price", "Problem"], ["Tea", "12,50", "Price is unclear; Stock is bad"]]);
});
