import assert from "node:assert/strict";
import test from "node:test";
import { rejectionText } from "../lib/sync/rejections.ts";

test("Stage 2F refusals read as plain sentences", () => {
  assert.equal(rejectionText("weight_mismatch"), "This till is out of date for a product sold by weight. Reload the till and sell it again.");
  assert.equal(rejectionText("scale_code_taken"), "That scale code is already used by another product.");
  assert.equal(rejectionText("invalid_scale_code"), "Scale codes are whole numbers from 1 to 999999.");
  assert.equal(rejectionText("weight_switch_needs_zero_stock"), "Set stock to 0 before changing how this product is sold.");
});
