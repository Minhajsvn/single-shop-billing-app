import assert from "node:assert/strict";
import test from "node:test";
import { calculateVatInclusive } from "../lib/domain.ts";

test("VAT-inclusive totals preserve every fils", () => {
  assert.deepEqual(calculateVatInclusive(2850), { netFils: 2714, vatFils: 136, grossFils: 2850 });
  assert.deepEqual(calculateVatInclusive(5700), { netFils: 5429, vatFils: 271, grossFils: 5700 });
});

test("document totals are the sum of persisted line totals", () => {
  const lines = [calculateVatInclusive(2850), calculateVatInclusive(4200), calculateVatInclusive(1850 * 2)];
  const totals = lines.reduce((result, line) => ({ netFils: result.netFils + line.netFils, vatFils: result.vatFils + line.vatFils, grossFils: result.grossFils + line.grossFils }), { netFils: 0, vatFils: 0, grossFils: 0 });
  assert.equal(totals.grossFils, totals.netFils + totals.vatFils);
  assert.equal(totals.grossFils, 10750);
});

test("partial credit uses the original VAT-inclusive unit value", () => {
  const original = calculateVatInclusive(2850 * 2);
  const returned = calculateVatInclusive(2850);
  assert.equal(original.grossFils - returned.grossFils, 2850);
  assert.equal(returned.netFils + returned.vatFils, returned.grossFils);
});
