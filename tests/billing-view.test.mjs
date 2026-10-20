import assert from "node:assert/strict";
import test from "node:test";
import { bannerFor, billingSummary, canWrite, dubaiDaysLeft, lifecycleState, registerOpenDecision } from "../lib/billing/lifecycle-view.ts";

const now = new Date("2026-10-19T10:00:00Z"); // 14:00 in Dubai
const base = {
  planId: "starter", status: "active", access: "full", trialEndsAt: null, graceEndsAt: null, accessEndsAt: null,
  cancelAt: null, hasPaymentMethod: true, billingInterval: "month", features: [], limits: { branches: 1, tills: 1, members: 3, products: null },
};
const pastDue = (graceEndsAt) => ({ ...base, status: "past_due", graceEndsAt });
const readOnly = { ...base, status: "canceled", access: "read_only", accessEndsAt: "2026-10-01T00:00:00Z" };
const trial = (trialEndsAt, extra = {}) => ({ ...base, planId: "pro", status: "trialing", trialEndsAt, accessEndsAt: trialEndsAt, hasPaymentMethod: false, ...extra });

test("dubaiDaysLeft counts Dubai calendar days and never goes negative", () => {
  assert.equal(dubaiDaysLeft("2026-10-24T09:00:00Z", now), 5);
  assert.equal(dubaiDaysLeft("2026-10-19T19:59:00Z", now), 0);
  // 21:00 UTC is already the next day in Dubai
  assert.equal(dubaiDaysLeft("2026-10-19T21:00:00Z", now), 1);
  assert.equal(dubaiDaysLeft("2026-10-01T00:00:00Z", now), 0);
});

test("past_due owner banner counts Dubai days", () => {
  const banner = bannerFor({ e: pastDue("2026-10-24T09:00:00Z"), stale: false, role: "owner", now });
  assert.deepEqual(banner, { tone: "yellow", text: "Payment failed. Your card was declined. Update it within 5 days to keep selling.", action: "update_card" });
  const cashier = bannerFor({ e: pastDue("2026-10-24T09:00:00Z"), stale: false, role: "cashier", now });
  assert.deepEqual(cashier, { tone: "yellow", text: "Payment failed. Ask the shop owner to update the card within 5 days. Sales continue as normal.", action: null });
  const last = bannerFor({ e: pastDue("2026-10-19T18:00:00Z"), stale: false, role: "owner", now });
  assert.match(last.text, /Update it today/);
});

test("read-only beats every other banner", () => {
  const owner = bannerFor({ e: { ...readOnly, status: "past_due" }, stale: true, role: "owner", now });
  assert.deepEqual(owner, { tone: "red", text: "Read-only. Sales are paused. Invoices, reports and exports still work.", action: "choose_plan" });
  const cashier = bannerFor({ e: readOnly, stale: true, role: "cashier", now });
  assert.deepEqual(cashier, { tone: "red", text: "Read-only. Sales are paused. Ask the shop owner to renew.", action: null });
});

test("stale shows the connect banner but does not block", () => {
  const banner = bannerFor({ e: base, stale: true, role: "owner", now });
  assert.deepEqual(banner, { tone: "grey", text: "Connect to the internet to check your subscription.", action: null });
  const device = { id: "d", name: "T1", tillNumber: 1, branchId: "b", branchName: "Main", status: "active" };
  assert.equal(registerOpenDecision({ e: base, stale: true, device, activeTills: 1, registerOpen: false, now }), "allow");
});

test("trial line only for owners from day 10", () => {
  const e = trial("2026-10-23T09:00:00Z"); // 4 Dubai days left
  assert.deepEqual(bannerFor({ e, stale: false, role: "owner", now }), { tone: "grey", text: "Pro trial · 4 days left · Choose a plan", action: "choose_plan" });
  assert.equal(bannerFor({ e, stale: false, role: "cashier", now }), null);
  assert.equal(bannerFor({ e, stale: false, role: "manager", now }), null);
  assert.equal(bannerFor({ e: trial("2026-10-24T09:00:00Z"), stale: false, role: "owner", now }), null);
});

test("no trial line once a card is on file", () => {
  assert.equal(bannerFor({ e: trial("2026-10-22T09:00:00Z", { hasPaymentMethod: true }), stale: false, role: "owner", now }), null);
});

test("an open register is never stopped", () => {
  const device = { id: "d", name: "T1", tillNumber: 1, branchId: "b", branchName: "Main", status: "paused" };
  assert.equal(registerOpenDecision({ e: readOnly, stale: false, device, activeTills: 3, registerOpen: true, now }), "allow");
  assert.equal(canWrite("read_only", true), true);
  assert.equal(canWrite("read_only", false), false);
  assert.equal(canWrite("full", false), true);
});

test("trial end reached on the device clock is read-only even if the cache says full", () => {
  const e = { ...trial("2026-10-18T09:00:00Z"), access: "full", accessEndsAt: "2026-10-18T09:00:00Z" };
  assert.equal(lifecycleState(e, now), "read_only");
  assert.equal(registerOpenDecision({ e, stale: false, device: null, activeTills: 1, registerOpen: false, now }), "read_only");
  assert.equal(lifecycleState(trial("2026-10-25T00:00:00Z"), now), "trial");
  assert.equal(lifecycleState(pastDue("2026-10-24T00:00:00Z"), now), "grace");
  assert.equal(lifecycleState(base, now), "full");
});

test("two active tills on Starter ask the owner to choose", () => {
  const device = { id: "d", name: "T1", tillNumber: 1, branchId: "b", branchName: "Main", status: "active" };
  assert.equal(registerOpenDecision({ e: base, stale: false, device, activeTills: 2, registerOpen: false, now }), "choose_till");
  assert.equal(registerOpenDecision({ e: base, stale: false, device, activeTills: 1, registerOpen: false, now }), "allow");
});

test("a paused till cannot open", () => {
  const device = { id: "d", name: "T2", tillNumber: 2, branchId: "b", branchName: "Main", status: "paused" };
  assert.equal(registerOpenDecision({ e: base, stale: false, device, activeTills: 1, registerOpen: false, now }), "till_paused");
});

test("billingSummary describes each state in plain words", () => {
  const at = new Date("2026-10-19T08:00:00Z");
  assert.equal(billingSummary(trial("2026-10-25T08:00:00Z"), at), "Pro trial · 6 days left");
  assert.equal(billingSummary(trial("2026-10-20T08:00:00Z"), at), "Pro trial · 1 day left");
  assert.equal(
    billingSummary(trial("2026-10-25T08:00:00Z", { hasPaymentMethod: true }), at),
    "Pro trial · 6 days left · Starter starts 25 Oct",
  );
  assert.equal(billingSummary({ ...base, accessEndsAt: "2026-11-19T08:00:00Z" }, at), "Starter · monthly · renews 19 Nov 2026");
  assert.equal(
    billingSummary({ ...base, billingInterval: "year", accessEndsAt: "2027-10-19T08:00:00Z" }, at),
    "Starter · annual · renews 19 Oct 2027",
  );
  assert.equal(
    billingSummary({ ...base, accessEndsAt: "2026-11-19T08:00:00Z", cancelAt: "2026-11-19T08:00:00Z" }, at),
    "Starter · cancels on 19 Nov 2026",
  );
  assert.equal(billingSummary(pastDue("2026-10-24T09:00:00Z"), at), "Payment failed · grace ends 24 Oct");
  assert.equal(billingSummary(readOnly, at), "Read-only since 1 Oct");
});
