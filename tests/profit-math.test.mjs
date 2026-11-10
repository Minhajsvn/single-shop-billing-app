import assert from "node:assert/strict";
import test from "node:test";
import { MAX_HISTORY_DAYS, isBelowCost, marginPct, periodRange, priceExVatFils } from "../lib/profit/math.ts";

test("priceExVatFils nets the price the way checkout does (standard 5% on every product today)", () => {
  assert.equal(priceExVatFils(2100, "standard"), 2000);
  // Checkout still charges standard VAT on zero-rated and exempt products (Stage 1D stores the category only),
  // so the margin shown on the form matches the profit the report will count.
  assert.equal(priceExVatFils(2100, "zero"), 2000);
  assert.equal(priceExVatFils(2100, "exempt"), 2000);
  assert.equal(priceExVatFils(1, "standard"), 1);
});

test("marginPct: one decimal, null without sales, negative below cost", () => {
  assert.equal(marginPct(2000, 1500), 25);
  assert.equal(marginPct(3000, 1000), 66.7);
  assert.equal(marginPct(0, 0), null);
  assert.equal(marginPct(-100, 0), null);
  assert.equal(marginPct(1000, 1500), -50);
});

test("isBelowCost compares the price excl. VAT with the cost", () => {
  assert.equal(isBelowCost({ priceFils: 2100, taxCategory: "standard" }, 2001), true);
  assert.equal(isBelowCost({ priceFils: 2100, taxCategory: "standard" }, 2000), false);
  assert.equal(isBelowCost({ priceFils: 2100, taxCategory: "standard" }, null), false);
});

test("periodRange: today and yesterday follow Dubai dates", () => {
  assert.deepEqual(periodRange("today", new Date("2026-12-31T22:00:00Z")), { from: "2027-01-01", to: "2027-01-01" });
  assert.deepEqual(periodRange("yesterday", new Date("2027-01-01T01:00:00Z")), { from: "2026-12-31", to: "2026-12-31" });
});

test("periodRange: this week starts Monday in Dubai", () => {
  assert.deepEqual(periodRange("this-week", new Date("2026-11-11T08:00:00Z")), { from: "2026-11-09", to: "2026-11-11" });
  // Monday 01:00 in Dubai is still Sunday in UTC.
  assert.deepEqual(periodRange("this-week", new Date("2026-11-08T21:00:00Z")), { from: "2026-11-09", to: "2026-11-09" });
  // Sunday belongs to the week that started the Monday before.
  assert.deepEqual(periodRange("this-week", new Date("2026-11-15T08:00:00Z")), { from: "2026-11-09", to: "2026-11-15" });
  // Across a year end.
  assert.deepEqual(periodRange("this-week", new Date("2027-01-01T08:00:00Z")), { from: "2026-12-28", to: "2027-01-01" });
});

test("periodRange: this month and last month", () => {
  assert.deepEqual(periodRange("this-month", new Date("2026-11-11T08:00:00Z")), { from: "2026-11-01", to: "2026-11-11" });
  assert.deepEqual(periodRange("last-month", new Date("2027-01-01T01:00:00Z")), { from: "2026-12-01", to: "2026-12-31" });
  assert.deepEqual(periodRange("last-month", new Date("2026-03-15T08:00:00Z")), { from: "2026-02-01", to: "2026-02-28" });
});

test("history window is 90 days", () => {
  assert.equal(MAX_HISTORY_DAYS, 90);
});
