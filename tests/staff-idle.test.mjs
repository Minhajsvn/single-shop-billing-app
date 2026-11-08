import assert from "node:assert/strict";
import test from "node:test";
import { shouldLock } from "../hooks/use-idle-lock.ts";

test("shouldLock: locks at the idle time, not before", () => {
  assert.equal(shouldLock(0, 4 * 60_000 + 59_000, 5), false);
  assert.equal(shouldLock(0, 5 * 60_000, 5), true);
  assert.equal(shouldLock(0, 60_000, 1), true);
  assert.equal(shouldLock(1_000, 60_999, 1), false);
});
