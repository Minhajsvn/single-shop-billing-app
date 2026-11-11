import assert from "node:assert/strict";
import test from "node:test";
import { parseScaleLabel } from "../lib/weighing/label.ts";
import { DEFAULT_SCALE_LABEL, normalizeScaleLabel } from "../lib/weighing/types.ts";

/** The 12 digits plus their EAN-13 check digit. */
function label(twelve) {
  let sum = 0;
  for (let index = 0; index < 12; index++) sum += Number(twelve[index]) * (index % 2 === 0 ? 1 : 3);
  return twelve + ((10 - (sum % 10)) % 10);
}

const weight = { prefixes: ["21", "22"], codeLength: 5, value: "weight" };

test("a weight label gives the scale code and grams", () => {
  assert.equal(label("210123400750"), "2101234007501");
  assert.deepEqual(parseScaleLabel("2101234007501", weight), { kind: "weight", scaleCode: 1234, grams: 750 });
  assert.deepEqual(parseScaleLabel(label("220000102500"), weight), { kind: "weight", scaleCode: 1, grams: 2500 });
});

test("a price label gives the scale code and fils", () => {
  assert.deepEqual(parseScaleLabel(label("210123403000"), { ...weight, value: "price" }), { kind: "price", scaleCode: 1234, priceFils: 3000 });
});

test("item code lengths 4 and 6 move the value digits", () => {
  assert.deepEqual(parseScaleLabel(label("211234000750"), { ...weight, codeLength: 4 }), { kind: "weight", scaleCode: 1234, grams: 750 });
  assert.deepEqual(parseScaleLabel(label("210012340750"), { ...weight, codeLength: 6 }), { kind: "weight", scaleCode: 1234, grams: 750 });
});

test("codes that are not labels for these settings", () => {
  assert.deepEqual(parseScaleLabel(label("230123400750"), weight), { error: "not_scale" }, "prefix not configured");
  assert.deepEqual(parseScaleLabel("210123400750", weight), { error: "not_scale" }, "12 digits");
  assert.deepEqual(parseScaleLabel(" ", weight), { error: "not_scale" });
  assert.deepEqual(parseScaleLabel("2101234007509", weight), { error: "bad_check_digit" });
  assert.deepEqual(parseScaleLabel(label("210123400000"), weight), { error: "no_value" });
  assert.deepEqual(parseScaleLabel(label("211234100001"), { ...weight, codeLength: 4 }), { error: "too_heavy" });
  assert.deepEqual(parseScaleLabel(label("210000000750"), weight), { error: "not_scale" }, "item code 0 is no item");
});

test("scale label settings normalize to the default when invalid", () => {
  assert.deepEqual(DEFAULT_SCALE_LABEL, { prefixes: ["21", "22"], codeLength: 5, value: "weight" });
  assert.deepEqual(normalizeScaleLabel(undefined), DEFAULT_SCALE_LABEL);
  assert.deepEqual(normalizeScaleLabel({ prefixes: ["19"], codeLength: 5, value: "weight" }), DEFAULT_SCALE_LABEL);
  assert.deepEqual(normalizeScaleLabel({ prefixes: ["23", "28"], codeLength: 6, value: "price" }), { prefixes: ["23", "28"], codeLength: 6, value: "price" });
});
