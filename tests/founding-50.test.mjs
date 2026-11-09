import assert from "node:assert/strict";
import test from "node:test";
import { parseEntitlements } from "../lib/billing/entitlements.ts";
import { dubaiDate, founderLine } from "../lib/billing/lifecycle-view.ts";

const now = new Date("2026-11-09T10:00:00Z");
const DAY = 86_400_000;
const base = {
  planId: "starter", status: "active", access: "full", trialEndsAt: null, graceEndsAt: null, accessEndsAt: null,
  cancelAt: null, hasPaymentMethod: true, billingInterval: "month", currentPeriodEnd: null, grantPlanId: null, grantEndsAt: null,
  features: [], limits: { branches: 1, tills: 1, members: 2, products: 5000 },
};
const inDays = (days) => new Date(now.getTime() + days * DAY).toISOString();
const founder = (endsAt, extra = {}) => ({ ...base, founder: { seatNo: 7, endsAt }, ...extra });

test("entitlements without a founder key still parse (older caches)", () => {
  assert.equal(parseEntitlements(base).founder, null);
});

test("entitlements keep a founder and refuse a bad seat number", () => {
  assert.deepEqual(parseEntitlements(founder("2027-11-09T10:00:00Z")).founder, { seatNo: 7, endsAt: "2027-11-09T10:00:00Z" });
  assert.throws(() => parseEntitlements({ ...base, founder: { seatNo: 0, endsAt: "2027-11-09T10:00:00Z" } }));
});

test("founderLine names the seat and the end date", () => {
  const end = inDays(200);
  assert.equal(founderLine(founder(end), now), `Founding member #7: Pro features at the Starter price until ${dubaiDate(end, true)}.`);
});

test("founderLine warns in the last 30 days", () => {
  const end = inDays(20);
  assert.equal(founderLine(founder(end), now),
    `Founding member #7: Pro features at the Starter price until ${dubaiDate(end, true)}. After that, Starter limits apply.`);
  assert.ok(founderLine(founder(inDays(30)), now).endsWith("After that, Starter limits apply."));
  assert.ok(!founderLine(founder(inDays(32)), now).includes("After that"));
});

test("founderLine is empty when there is no active founder", () => {
  assert.equal(founderLine(founder(inDays(-1)), now), null);
  assert.equal(founderLine({ ...base, founder: null }, now), null);
  assert.equal(founderLine(founder(inDays(200), { grantPlanId: "pro", grantEndsAt: null }), now), null);
});
