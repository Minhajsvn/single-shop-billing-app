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

// Admin console.
import { adminErrorMessage, parseRevokeFounder } from "../lib/admin/actions.ts";
import { adminDateTime, founderText } from "../lib/admin/shop-view.ts";

const row = (extra = {}) => ({
  seatNo: 3, claimedAt: "2026-11-01T08:00:00Z", endsAt: "2027-11-01T08:00:00Z", endedAt: null, endReason: null, revokeNote: null, ...extra,
});

test("founderText describes each founder state", () => {
  assert.equal(founderText(null, now), "No");
  assert.equal(founderText(row(), now), `#3 · until ${adminDateTime("2027-11-01T08:00:00Z")}`);
  assert.equal(founderText(row({ endsAt: "2026-11-01T09:00:00Z" }), now), `#3 · ended ${adminDateTime("2026-11-01T09:00:00Z")} (12 months up)`);
  assert.equal(founderText(row({ endedAt: "2026-11-05T08:00:00Z", endReason: "canceled" }), now),
    `#3 · ended ${adminDateTime("2026-11-05T08:00:00Z")} (cancelled)`);
  assert.equal(founderText(row({ endedAt: "2026-11-06T08:00:00Z", endReason: "revoked", revokeNote: "fraud" }), now),
    `#3 · revoked ${adminDateTime("2026-11-06T08:00:00Z")}: fraud`);
  assert.equal(founderText(row({ endedAt: "2026-11-07T08:00:00Z", endReason: "upgraded" }), now),
    `#3 · ended ${adminDateTime("2026-11-07T08:00:00Z")} (upgraded)`);
});

test("parseRevokeFounder needs a note", () => {
  assert.deepEqual(parseRevokeFounder({}), { ok: false, error: adminErrorMessage("note_required") });
  assert.deepEqual(parseRevokeFounder({ note: " fraud " }), { ok: true, note: "fraud" });
});

test("not_a_founder has plain words", () => {
  assert.equal(adminErrorMessage("not_a_founder"), "This shop is not a founding member.");
});
