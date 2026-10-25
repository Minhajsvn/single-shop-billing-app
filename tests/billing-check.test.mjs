import assert from "node:assert/strict";
import test from "node:test";
import { compareSubscription, flagFieldLabel, flagValueText, MISSING_SUBSCRIPTION, ourStatusFor, TIME_TOLERANCE_MS } from "../lib/billing/billing-check.ts";
import { billingProvider, BILLING_NOT_SET_UP } from "../lib/billing/provider.ts";
import { subscriptionSnapshot } from "../lib/billing/stripe-events.ts";
import { runBillingCheckWith } from "../lib/admin/billing-check-run.ts";
import { billingCheckCaller, CRON_SECRET_HEADER } from "../lib/admin/staff.ts";

const HOUR = 60 * 60 * 1000;
const at = (iso, ms = 0) => new Date(Date.parse(iso) + ms).toISOString();

const ours = {
  status: "active",
  current_period_end: "2026-11-25T10:00:00.000Z",
  cancel_at: null,
  trial_ends_at: "2026-10-20T10:00:00.000Z",
};
const theirs = {
  exists: true,
  status: "active",
  currentPeriodEnd: "2026-11-25T10:00:00.000Z",
  cancelAt: null,
  trialEnd: "2026-10-20T10:00:00.000Z",
};

test("matching records have no mismatches", () => {
  assert.deepEqual(compareSubscription(ours, theirs), []);
});

test("a different status is one status mismatch with Stripe's own word", () => {
  assert.deepEqual(compareSubscription(ours, { ...theirs, status: "past_due" }), [{ field: "status", ours: "active", theirs: "past_due" }]);
  assert.deepEqual(compareSubscription(ours, { ...theirs, status: "canceled" }), [{ field: "status", ours: "active", theirs: "canceled" }]);
});

test("statuses are mapped the way the webhook maps them", () => {
  assert.equal(ourStatusFor("unpaid"), "past_due");
  assert.equal(ourStatusFor("past_due"), "past_due");
  assert.equal(ourStatusFor("trialing"), "trialing");
  assert.equal(ourStatusFor("active"), "active");
  assert.equal(ourStatusFor("canceled"), "canceled");
  for (const ignored of ["incomplete", "incomplete_expired", "paused", null, "something_new"]) assert.equal(ourStatusFor(ignored), null);
  // unpaid in Stripe is past_due for us: no flag.
  assert.deepEqual(compareSubscription({ ...ours, status: "past_due" }, { ...theirs, status: "unpaid" }), []);
  // A status we never apply from the webhook is not a disagreement.
  assert.deepEqual(compareSubscription(ours, { ...theirs, status: "incomplete" }), []);
  assert.deepEqual(compareSubscription(ours, { ...theirs, status: "incomplete_expired" }), []);
});

test("current period end matches within one hour either way", () => {
  assert.deepEqual(compareSubscription(ours, { ...theirs, currentPeriodEnd: at(ours.current_period_end, HOUR) }), []);
  assert.deepEqual(compareSubscription(ours, { ...theirs, currentPeriodEnd: at(ours.current_period_end, -HOUR) }), []);
  assert.equal(TIME_TOLERANCE_MS, HOUR);
  const later = at(ours.current_period_end, HOUR + 1000);
  assert.deepEqual(compareSubscription(ours, { ...theirs, currentPeriodEnd: later }), [{ field: "current_period_end", ours: ours.current_period_end, theirs: later }]);
  assert.deepEqual(compareSubscription(ours, { ...theirs, currentPeriodEnd: null }), [{ field: "current_period_end", ours: ours.current_period_end, theirs: null }]);
});

test("cancel_at: set on one side only, or more than an hour apart", () => {
  const cancel = "2026-11-25T10:00:00.000Z";
  assert.deepEqual(compareSubscription(ours, { ...theirs, cancelAt: cancel }), [{ field: "cancel_at", ours: null, theirs: cancel }]);
  assert.deepEqual(compareSubscription({ ...ours, cancel_at: cancel }, { ...theirs, cancelAt: at(cancel, 30 * 60 * 1000) }), []);
  assert.deepEqual(compareSubscription({ ...ours, cancel_at: cancel }, { ...theirs, cancelAt: at(cancel, 2 * HOUR) }), [{ field: "cancel_at", ours: cancel, theirs: at(cancel, 2 * HOUR) }]);
  assert.deepEqual(compareSubscription({ ...ours, cancel_at: cancel }, theirs), [{ field: "cancel_at", ours: cancel, theirs: null }]);
});

test("trial_end: compared with an hour's tolerance", () => {
  const trialing = { ...ours, status: "trialing", trial_ends_at: "2026-11-01T10:00:00.000Z", current_period_end: "2026-11-01T10:00:00.000Z" };
  const stripeTrial = { ...theirs, status: "trialing", trialEnd: "2026-11-01T10:30:00.000Z", currentPeriodEnd: "2026-11-01T10:00:00.000Z" };
  assert.deepEqual(compareSubscription(trialing, stripeTrial), []);
  assert.deepEqual(compareSubscription(trialing, { ...stripeTrial, trialEnd: "2026-11-03T10:00:00.000Z" }), [{ field: "trial_end", ours: trialing.trial_ends_at, theirs: "2026-11-03T10:00:00.000Z" }]);
  assert.deepEqual(compareSubscription(trialing, { ...stripeTrial, trialEnd: null }), [{ field: "trial_end", ours: trialing.trial_ends_at, theirs: null }]);
  // Stripe never had a trial (checked out after our signup trial): our old trial end is not a disagreement.
  assert.deepEqual(compareSubscription(ours, { ...theirs, trialEnd: null }), []);
});

test("several fields disagreeing give one mismatch each, in a fixed order", () => {
  const result = compareSubscription(ours, { exists: true, status: "past_due", currentPeriodEnd: "2026-12-25T10:00:00.000Z", cancelAt: "2026-12-25T10:00:00.000Z", trialEnd: "2026-10-01T10:00:00.000Z" });
  assert.deepEqual(result.map((m) => m.field), ["status", "current_period_end", "cancel_at", "trial_end"]);
});

test("a canceled subscription on both sides only compares the status", () => {
  const canceled = { ...ours, status: "canceled", cancel_at: null };
  assert.deepEqual(compareSubscription(canceled, { ...theirs, status: "canceled", cancelAt: "2026-10-01T00:00:00.000Z", currentPeriodEnd: null }), []);
});

test("a missing Stripe subscription is one exists mismatch", () => {
  assert.deepEqual(compareSubscription(ours, MISSING_SUBSCRIPTION), [{ field: "exists", ours: "yes", theirs: "no" }]);
  assert.deepEqual(compareSubscription(ours, { ...theirs, exists: false, status: "past_due" }), [{ field: "exists", ours: "yes", theirs: "no" }]);
});

test("subscriptionSnapshot reads the period end from subscription items (API 2026-09-30)", () => {
  const snap = subscriptionSnapshot({
    id: "sub_1", status: "active", trial_end: null, cancel_at: null, cancel_at_period_end: true,
    items: { data: [{ current_period_end: 1795000000 }, { current_period_end: 1795003600 }] },
  });
  assert.deepEqual(snap, {
    exists: true, status: "active",
    currentPeriodEnd: new Date(1795003600 * 1000).toISOString(),
    cancelAt: new Date(1795003600 * 1000).toISOString(),
    trialEnd: null,
  });
});

test("getSubscription: none throws the plain message", async () => {
  const none = billingProvider({ NODE_ENV: "production" });
  assert.equal(none.kind, "none");
  await assert.rejects(() => none.getSubscription("sub_1"), new Error(BILLING_NOT_SET_UP));
});

test("getSubscription: pretend knows only the subscriptions it made", async () => {
  const pretend = billingProvider({ NODE_ENV: "development" });
  assert.equal(pretend.kind, "pretend");
  // A Stripe-like id is not one the pretend provider created, so it does not exist there (no database read).
  assert.equal(await pretend.getSubscription("sub_1LiveLooking"), null);
});

test("flag fields and values in plain words", () => {
  const fmt = (iso) => `T(${iso})`;
  assert.equal(flagFieldLabel("current_period_end"), "Current period end");
  assert.equal(flagFieldLabel("exists"), "Subscription exists in Stripe");
  assert.equal(flagValueText("status", "past_due", fmt), "Past due");
  assert.equal(flagValueText("status", "incomplete", fmt), "incomplete");
  assert.equal(flagValueText("trial_end", "2026-11-01T10:00:00.000Z", fmt), "T(2026-11-01T10:00:00.000Z)");
  assert.equal(flagValueText("cancel_at", null, fmt), "Not cancelling");
  assert.equal(flagValueText("current_period_end", null, fmt), "—");
  assert.equal(flagValueText("exists", "no", fmt), "No");
  assert.equal(flagValueText("exists", "yes", fmt), "Yes");
});

// --- runner -------------------------------------------------------------------------------------

function fakeAdmin({ shops, rows }) {
  const calls = [];
  const admin = {
    calls,
    rpc(name, args) {
      calls.push({ rpc: name, args });
      if (name === "admin_billing_check_shops") return Promise.resolve({ data: shops, error: null });
      if (name === "admin_record_billing_check") return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: null, error: { message: `unexpected rpc ${name}` } });
    },
    from(table) {
      const query = { table, filters: [], op: "select" };
      calls.push({ from: query });
      const builder = {
        select(columns) { query.columns = columns; return builder; },
        eq(column, value) { query.filters.push([column, value]); return builder; },
        maybeSingle() {
          const id = query.filters.find(([c]) => c === "business_id")?.[1];
          return Promise.resolve({ data: rows[id] ?? null, error: null });
        },
      };
      for (const write of ["insert", "update", "upsert", "delete"]) {
        builder[write] = () => { query.op = write; return builder; };
      }
      return builder;
    },
  };
  return admin;
}

const SHOP_A = "a0000000-0000-4000-8000-000000000001";
const SHOP_B = "a0000000-0000-4000-8000-000000000002";
const rowFor = (sub) => ({ ...ours, stripe_subscription_id: sub });

test("the runner only reads subscriptions and only writes through admin_record_billing_check", async () => {
  const admin = fakeAdmin({ shops: [SHOP_A, SHOP_B], rows: { [SHOP_A]: rowFor("sub_a"), [SHOP_B]: rowFor("sub_b") } });
  const provider = {
    kind: "stripe",
    async getSubscription(id) { return id === "sub_a" ? theirs : { ...theirs, status: "past_due" }; },
  };
  const result = await runBillingCheckWith({ admin, provider }, {});
  assert.deepEqual(result, { checked: 2, mismatches: 1, failed: 0 });

  const rpcs = admin.calls.filter((c) => c.rpc).map((c) => c.rpc);
  assert.deepEqual(rpcs, ["admin_billing_check_shops", "admin_record_billing_check", "admin_record_billing_check"]);
  for (const call of admin.calls.filter((c) => c.from)) {
    assert.equal(call.from.table, "subscriptions");
    assert.equal(call.from.op, "select", "the runner never writes subscriptions");
  }
  const records = admin.calls.filter((c) => c.rpc === "admin_record_billing_check").map((c) => c.args);
  assert.deepEqual(records, [
    { p_business_id: SHOP_A, p_mismatches: [] },
    { p_business_id: SHOP_B, p_mismatches: [{ field: "status", ours: "active", theirs: "past_due" }] },
  ]);
});

test("the runner checks one shop when asked, and a missing Stripe subscription is recorded", async () => {
  const admin = fakeAdmin({ shops: [SHOP_A, SHOP_B], rows: { [SHOP_A]: rowFor("sub_a"), [SHOP_B]: rowFor("sub_b") } });
  const provider = { kind: "stripe", async getSubscription() { return null; } };
  const result = await runBillingCheckWith({ admin, provider }, { businessId: SHOP_B });
  assert.deepEqual(result, { checked: 1, mismatches: 1, failed: 0 });
  const records = admin.calls.filter((c) => c.rpc === "admin_record_billing_check").map((c) => c.args);
  assert.deepEqual(records, [{ p_business_id: SHOP_B, p_mismatches: [{ field: "exists", ours: "yes", theirs: "no" }] }]);
});

test("a shop the provider cannot answer for is counted as failed and records nothing", async () => {
  const admin = fakeAdmin({ shops: [SHOP_A], rows: { [SHOP_A]: rowFor("sub_a") } });
  const provider = { kind: "stripe", async getSubscription() { throw new Error("network down"); } };
  const original = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await runBillingCheckWith({ admin, provider }, {}), { checked: 0, mismatches: 0, failed: 1 });
  } finally {
    console.error = original;
  }
  assert.equal(admin.calls.filter((c) => c.rpc === "admin_record_billing_check").length, 0);
});

test("with no billing provider the runner does nothing", async () => {
  const admin = fakeAdmin({ shops: [SHOP_A], rows: {} });
  const provider = billingProvider({ NODE_ENV: "production" });
  assert.deepEqual(await runBillingCheckWith({ admin, provider }, {}), { error: BILLING_NOT_SET_UP });
  assert.equal(admin.calls.length, 0);
});

// --- route access -------------------------------------------------------------------------------

test("the billing check route takes a staff session or the cron secret, nothing else", () => {
  const env = { ADMIN_CRON_SECRET: "s".repeat(32) };
  assert.equal(CRON_SECRET_HEADER, "x-admin-cron-secret");
  assert.equal(billingCheckCaller(true, null, env), "staff");
  assert.equal(billingCheckCaller(true, "wrong", env), "staff");
  assert.equal(billingCheckCaller(false, "s".repeat(32), env), "cron");
  assert.equal(billingCheckCaller(false, "s".repeat(31), env), null);
  assert.equal(billingCheckCaller(false, null, env), null);
  assert.equal(billingCheckCaller(false, "", env), null);
  // A short or missing secret disables the cron path, even when the header matches it.
  assert.equal(billingCheckCaller(false, "short", { ADMIN_CRON_SECRET: "short" }), null);
  assert.equal(billingCheckCaller(false, "anything", {}), null);
});
