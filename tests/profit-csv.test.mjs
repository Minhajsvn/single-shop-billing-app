import assert from "node:assert/strict";
import test from "node:test";
import { profitCsv } from "../lib/profit/csv.ts";

const report = {
  totals: { netFils: 5000, costedNetFils: 4000, costFils: 2500, profitFils: 1500, marginPct: 37.5, uncostedNetFils: 1000, uncostedLines: 2 },
  byDay: [{ date: "2026-11-10", netFils: 5000, costFils: 2500, profitFils: 1500 }],
  byCategory: [
    { categoryId: "c1", name: "Drinks", netFils: 4000, costFils: 2500, profitFils: 1500, marginPct: 37.5 },
    { categoryId: null, name: "Uncategorised", netFils: 1250, costFils: 0, profitFils: 0, marginPct: null },
  ],
  byProduct: [{ productId: "p1", name: "=HYPERLINK(1)", quantity: 2, netFils: 4000, costFils: 2500, profitFils: 1500, marginPct: 37.5 }],
};

test("profitCsv: one file per table with fixed headings, AED with 2 decimals, blank margin when there is none", () => {
  assert.equal(profitCsv("day", report), '"Date","Net AED","Cost AED","Profit AED"\r\n"2026-11-10","50.00","25.00","15.00"');
  const category = profitCsv("category", report).split("\r\n");
  assert.equal(category[0], '"Category","Net AED","Cost AED","Profit AED","Margin %"');
  assert.equal(category[2], '"Uncategorised","12.50","0.00","0.00",""');
});

test("profitCsv: a product name that looks like a formula is quoted safely", () => {
  const product = profitCsv("product", report).split("\r\n");
  assert.equal(product[0], '"Product","Quantity","Net AED","Cost AED","Profit AED","Margin %"');
  assert.equal(product[1], `"'=HYPERLINK(1)","2","40.00","25.00","15.00","37.5"`);
});
