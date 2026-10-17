import assert from "node:assert/strict";
import test from "node:test";
import { saleBlockReason, staleRegister } from "../lib/checkout/register-status.ts";

const open = (openedAt) => ({ id: "r", status: "open", openedAt, openingCashFils: 0, adjustments: [] });

test("a register opened earlier on the same Dubai day is not stale", () => {
  assert.deepEqual(staleRegister(open("2026-10-15T04:00:00Z"), new Date("2026-10-15T19:59:00Z")), { stale: false });
});

test("Dubai midnight (20:00 UTC) makes yesterday's register stale", () => {
  assert.deepEqual(staleRegister(open("2026-10-15T04:00:00Z"), new Date("2026-10-15T20:00:00Z")), { stale: true, openedOn: "2026-10-15" });
});

test("closed or missing registers are never stale", () => {
  assert.deepEqual(staleRegister({ ...open("2026-10-01T04:00:00Z"), status: "closed" }, new Date("2026-10-15T10:00:00Z")), { stale: false });
  assert.deepEqual(staleRegister(null, new Date()), { stale: false });
});

test("saleBlockReason refuses a closed or stale register at the moment of sale", () => {
  assert.equal(saleBlockReason(null, new Date()), "Open the register before completing a sale.");
  assert.equal(saleBlockReason({ ...open("2026-10-15T04:00:00Z"), status: "closed" }, new Date("2026-10-15T10:00:00Z")), "Open the register before completing a sale.");
  // Dialog opened at 23:59:50 Dubai, completed at 00:00:05: the sale must not land on yesterday's register.
  assert.equal(saleBlockReason(open("2026-10-15T04:00:00Z"), new Date("2026-10-15T20:00:05Z")), "Close the register opened on 2026-10-15 before selling.");
  assert.equal(saleBlockReason(open("2026-10-15T04:00:00Z"), new Date("2026-10-15T19:59:50Z")), null);
});
