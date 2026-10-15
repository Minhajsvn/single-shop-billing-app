import assert from "node:assert/strict";
import test from "node:test";
import { cartTotals, changeDue, discountedUnit, parseMoneyInput, quickCashAmounts } from "../lib/checkout/pricing.ts";

test("percent discounts round each unit to whole fils (half up)", () => {
  assert.deepEqual(discountedUnit(285, { kind: "percent", percent: 15 }), { ok: true, unitGrossFils: 242 });
  assert.deepEqual(discountedUnit(2850, { kind: "percent", percent: 10 }), { ok: true, unitGrossFils: 2565 });
  assert.deepEqual(discountedUnit(2850, { kind: "percent", percent: 12.5 }), { ok: true, unitGrossFils: 2494 });
});

test("amount discounts take a fixed sum off each unit", () => {
  assert.deepEqual(discountedUnit(2850, { kind: "amount", offEachFils: 350 }), { ok: true, unitGrossFils: 2500 });
});

test("a discount can never make an item free or negative", () => {
  assert.equal(discountedUnit(2850, { kind: "percent", percent: 100 }).ok, false);
  assert.equal(discountedUnit(2850, { kind: "amount", offEachFils: 2850 }).ok, false);
  assert.equal(discountedUnit(2850, { kind: "percent", percent: 0 }).ok, false);
  assert.equal(discountedUnit(2850, { kind: "percent", percent: -5 }).ok, false);
  assert.equal(discountedUnit(2850, { kind: "amount", offEachFils: 10.5 }).ok, false);
});

test("cart totals add up per line and report the total saving", () => {
  const totals = cartTotals([
    { unitGrossFils: 242, quantity: 3, listUnitGrossFils: 285 },
    { unitGrossFils: 1000, quantity: 1 },
  ]);
  assert.equal(totals.grossFils, 242 * 3 + 1000);
  assert.equal(totals.netFils + totals.vatFils, totals.grossFils);
  assert.equal(totals.discountFils, (285 - 242) * 3);
});

test("change due needs enough cash", () => {
  assert.deepEqual(changeDue(5700, 10000), { ok: true, changeFils: 4300 });
  assert.deepEqual(changeDue(5700, 5700), { ok: true, changeFils: 0 });
  assert.equal(changeDue(5700, 5000).ok, false);
});

test("quick cash amounts start exact and climb to common notes", () => {
  assert.deepEqual(quickCashAmounts(5700), [5700, 6000, 10000, 20000]);
  assert.deepEqual(quickCashAmounts(10000), [10000, 20000, 50000, 100000]);
  assert.deepEqual(quickCashAmounts(123456), [123456, 123500, 124000, 125000]);
});

test("money input is parsed strictly", () => {
  assert.equal(parseMoneyInput("28.5"), 2850);
  assert.equal(parseMoneyInput(" 100 "), 10000);
  assert.equal(parseMoneyInput("0.05"), 5);
  assert.equal(parseMoneyInput(""), null);
  assert.equal(parseMoneyInput("abc"), null);
  assert.equal(parseMoneyInput("1.234"), null);
  assert.equal(parseMoneyInput("-5"), null);
});
