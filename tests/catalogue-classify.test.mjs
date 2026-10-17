import assert from "node:assert/strict";
import test from "node:test";
import { MAX_IMPORT_ROWS, nextGeneratedSkus, planImport } from "../lib/catalogue/classify.ts";

const HEAD = ["Name", "SKU", "Barcode", "Price", "Stock"];
const MAP = { name: 0, sku: 1, barcode: 2, price: 3, stock: 4 };
const product = (over) => ({ id: over.id, name: over.name ?? over.id, sku: over.sku ?? over.id.toUpperCase(), barcode: over.barcode, priceFils: over.priceFils ?? 1000, stock: over.stock ?? 5, lowStockThreshold: 5, active: over.active ?? true, taxCategory: "standard" });
let seq = 0;
const options = (productLimit = null) => ({ productLimit, newId: () => `new-${++seq}` });
const plan = (rows, existing = [], limit = null, mapping = MAP) => {
  const result = planImport([HEAD, ...rows], mapping, existing, options(limit));
  assert.equal(result.ok, true, result.error);
  return result.plan;
};

test("refuses a file with more than 5,000 data rows, or with no name or price column", () => {
  assert.equal(MAX_IMPORT_ROWS, 5000);
  const big = Array.from({ length: 5001 }, (_, i) => [`Item ${i}`, "", "", "1", "1"]);
  assert.deepEqual(planImport([HEAD, ...big], MAP, [], options()), { ok: false, error: "This file has 5,001 rows; split it into files of at most 5,000." });
  assert.deepEqual(planImport([HEAD, ["Tea", "", "", "1", "1"]], { name: 0 }, [], options()), { ok: false, error: "Choose which column holds the product name and the price." });
});

test("barcode match updates price and replaces stock; unchanged values give changed:false", () => {
  const water = product({ id: "w", barcode: "6291100211014", priceFils: 2850, stock: 52 });
  const p = plan([["Water", "", "6291100211014", "30.00", "40"], ["Water again", "", "6291100211014", "28.50", "52"]].slice(0, 1), [water]);
  assert.equal(p.creates.length, 0);
  assert.deepEqual(p.updates[0], { rowNumber: 2, productId: "w", archived: false, before: { priceFils: 2850, stock: 52, barcode: "6291100211014" }, after: { priceFils: 3000, stock: 40, barcode: "6291100211014" }, changed: true });
  const same = plan([["Water", "", "6291100211014", "28.50", "52"]], [water]);
  assert.equal(same.updates[0].changed, false);
});

test("no barcode but SKU match (case-insensitive) updates; an incoming barcode is added when no other product has it", () => {
  const tea = product({ id: "t", sku: "TEA-1", priceFils: 500, stock: 3 });
  const p = plan([["Tea", "tea-1", "", "5", "3"]], [tea]);
  assert.equal(p.updates[0].productId, "t");
  assert.equal(p.updates[0].changed, false);
  const withBarcode = plan([["Tea", "TEA-1", "4006381333931", "5", "3"]], [tea]);
  assert.equal(withBarcode.updates[0].after.barcode, "4006381333931");
  assert.equal(withBarcode.updates[0].changed, true);
});

test("barcode → product A and SKU → product B is a problem", () => {
  const a = product({ id: "a", barcode: "111" });
  const b = product({ id: "b", sku: "B-1" });
  const p = plan([["X", "B-1", "111", "5", "1"]], [a, b]);
  assert.deepEqual(p.problems.map((row) => row.reasons), [["Barcode and SKU belong to two different products"]]);
  assert.equal(p.updates.length + p.creates.length, 0);
});

test("SKU match whose product already has a different barcode is a problem", () => {
  const b = product({ id: "b", sku: "B-1", barcode: "222" });
  const p = plan([["X", "B-1", "333", "5", "1"]], [b]);
  assert.deepEqual(p.problems[0].reasons, ["This SKU's product already has barcode 222"]);
});

test("blank stock on an update keeps current stock; blank stock on a create is 0", () => {
  const w = product({ id: "w", barcode: "9", stock: 7 });
  const p = plan([["W", "", "9", "10", ""], ["New", "", "", "2", ""]], [w]);
  assert.equal(p.updates[0].after.stock, 7);
  assert.equal(p.creates[0].product.stock, 0);
});

test("several blank-barcode rows all become creates with generated SKUs and defaults", () => {
  const p = plan([["A", "", "", "1", "1"], ["B", "", "", "2", "2"], ["C", "", "", "3", "3"]]);
  assert.equal(p.creates.length, 3);
  assert.deepEqual(p.creates.map((c) => c.product.sku), ["P-0001", "P-0002", "P-0003"]);
  assert.equal(p.creates[0].product.barcode, undefined);
  assert.equal(p.creates[0].product.lowStockThreshold, 5);
  assert.equal(p.creates[0].product.taxCategory, "standard");
  assert.match(p.creates[0].product.id, /^new-/);
});

test("repeated barcode or SKU within the file flags every copy", () => {
  const p = plan([["A", "", "123", "1", "1"], ["B", "", "123", "1", "1"], ["C", "S1", "", "1", "1"], ["D", "s1", "", "1", "1"]]);
  assert.equal(p.creates.length, 0);
  assert.deepEqual(p.problems.map((row) => [row.rowNumber, row.reasons]), [
    [2, ["Barcode appears more than once in this file"]], [3, ["Barcode appears more than once in this file"]],
    [4, ["SKU appears more than once in this file"]], [5, ["SKU appears more than once in this file"]],
  ]);
});

test("bad cells become problem rows with every reason; wholly blank rows are skipped", () => {
  const p = plan([["", "", "", "12,50", "4.5"], ["", "", "", "", ""]]);
  assert.equal(p.problems.length, 1);
  assert.equal(p.problems[0].rowNumber, 2);
  assert.equal(p.problems[0].reasons.length, 3);
  assert.deepEqual(p.problems[0].cells, ["", "", "", "12,50", "4.5"]);
});

test("unmatched row whose name equals an existing name (ignoring case/spacing) is a create with possibleDuplicateOf", () => {
  const p = plan([["  green   TEA ", "", "", "5", "1"]], [product({ id: "g", name: "Green Tea", sku: "G" })]);
  assert.equal(p.creates[0].possibleDuplicateOf, "Green Tea");
});

test("generated SKUs continue after the highest P- number and skip SKUs in the file", () => {
  assert.deepEqual(nextGeneratedSkus(["P-0007", "p-0002", "ABC"], 2), ["P-0008", "P-0009"]);
  const p = plan([["A", "P-0001", "", "1", "1"], ["B", "", "", "1", "1"]]);
  assert.deepEqual(p.creates.map((c) => c.product.sku), ["P-0001", "P-0002"]);
});

test("plan limit: 4,990 active + 20 creates with limit 5,000 → 10 creates, 10 problems with the over-limit text", () => {
  const existing = Array.from({ length: 4990 }, (_, i) => product({ id: `e${i}` }));
  existing.push(product({ id: "archived", active: false }));
  const rows = Array.from({ length: 20 }, (_, i) => [`New ${i}`, "", "", "1", "1"]);
  const p = plan(rows, existing, 5000);
  assert.equal(p.creates.length, 10);
  assert.equal(p.problems.length, 10);
  assert.deepEqual(p.problems[0].reasons, ["Over your plan's limit of 5000 products: upgrade to Pro"]);
  assert.equal(p.problems[0].rowNumber, 12);
});

test("an archived product matched by barcode is an update with archived:true", () => {
  const p = plan([["Old", "", "77", "1", "1"]], [product({ id: "o", barcode: "77", active: false })], 1);
  assert.equal(p.updates[0].archived, true);
  assert.equal(p.problems.length, 0);
});

test.todo("round trip: planImport(parseCsv(productsToCsv(products))) has 0 creates, 0 problems, every update changed:false");
