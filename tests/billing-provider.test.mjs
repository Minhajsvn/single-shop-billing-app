import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hasPlaceholders, SITE_INFO } from "../lib/site-info.ts";
import {
  billingProvider, BILLING_NOT_SET_UP, MIN_START_LEAD_MS, RAZORPAY_MAX_COUNT, razorpayProvider, subscriptionCreateBody,
} from "../lib/billing/provider.ts";
import { razorpayRequest } from "../lib/billing/razorpay-api.ts";
import { cancelDecision } from "../lib/billing/cancel-decision.ts";
import { runCancel } from "../lib/billing/run-cancel.ts";
import { handleRazorpayWebhook } from "../lib/billing/webhook-handler.ts";
import { pretendAvailable } from "../lib/billing/pretend-events.ts";

const FILLED = { legalName: "Acme Trading LLC", address: "Dubai", email: "help@acme.example", phone: "+971 4 000 0000" };
const RAZORPAY_ENV = {
  RAZORPAY_KEY_ID: "rzp_test_id",
  RAZORPAY_KEY_SECRET: "secret",
  RAZORPAY_WEBHOOK_SECRET: "whsec",
  RAZORPAY_PLAN_STARTER_MONTHLY: "plan_MONTH000000001",
  RAZORPAY_PLAN_STARTER_ANNUAL: "plan_YEAR0000000001",
};
const BUSINESS = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-20T10:00:00Z");

// --- site info ----------------------------------------------------------------------------------

test("hasPlaceholders: false for the shipped SITE_INFO (all details filled); false when every field is filled; true when one field is empty", () => {
  assert.equal(hasPlaceholders(SITE_INFO), false);
  assert.equal(hasPlaceholders(FILLED), false);
  assert.equal(hasPlaceholders({ ...FILLED, phone: "" }), true);
  assert.equal(hasPlaceholders({ ...FILLED, email: "[SUPPORT EMAIL]" }), true);
});

// --- provider selection -------------------------------------------------------------------------

test("billingProvider: all five set + filled info -> razorpay", () => {
  assert.equal(billingProvider({ ...RAZORPAY_ENV, NODE_ENV: "production" }, FILLED).kind, "razorpay");
  assert.equal(billingProvider({ ...RAZORPAY_ENV, NODE_ENV: "development" }, FILLED).kind, "razorpay");
});

test("billingProvider: all five set + placeholders -> none, also in production", () => {
  const placeholders = { ...FILLED, email: "[SUPPORT EMAIL]" };
  assert.equal(billingProvider({ ...RAZORPAY_ENV, NODE_ENV: "production" }, placeholders).kind, "none");
  assert.equal(billingProvider({ ...RAZORPAY_ENV, NODE_ENV: "development" }, placeholders).kind, "none");
});

test("billingProvider: four of five -> none in development and production", () => {
  const four = { ...RAZORPAY_ENV };
  delete four.RAZORPAY_PLAN_STARTER_ANNUAL;
  assert.equal(billingProvider({ ...four, NODE_ENV: "development" }, FILLED).kind, "none");
  assert.equal(billingProvider({ ...four, NODE_ENV: "production" }, FILLED).kind, "none");
});

test("billingProvider: none set, development -> pretend; production -> none", () => {
  assert.equal(billingProvider({ NODE_ENV: "development" }, FILLED).kind, "pretend");
  assert.equal(billingProvider({ NODE_ENV: "production" }, FILLED).kind, "none");
});

test("pretendAvailable: only the pretend provider", () => {
  assert.equal(pretendAvailable("pretend"), true);
  assert.equal(pretendAvailable("none"), false);
  assert.equal(pretendAvailable("razorpay"), false);
});

// --- subscription body --------------------------------------------------------------------------

test("subscriptionCreateBody: trial 5 days away -> start_at is the trial end in unix seconds, notes and plan set", () => {
  const trialEnd = new Date(NOW.getTime() + 5 * 86400_000);
  const month = subscriptionCreateBody(RAZORPAY_ENV, { businessId: BUSINESS, interval: "month", trialEndsAt: trialEnd.toISOString() }, NOW);
  assert.deepEqual(month, {
    plan_id: "plan_MONTH000000001",
    total_count: RAZORPAY_MAX_COUNT.month,
    customer_notify: 1,
    notes: { business_id: BUSINESS, interval: "month" },
    start_at: Math.floor(trialEnd.getTime() / 1000),
  });
  const year = subscriptionCreateBody(RAZORPAY_ENV, { businessId: BUSINESS, interval: "year", trialEndsAt: null }, NOW);
  assert.equal(year.plan_id, "plan_YEAR0000000001");
  assert.equal(year.total_count, RAZORPAY_MAX_COUNT.year);
  assert.deepEqual(year.notes, { business_id: BUSINESS, interval: "year" });
});

test("subscriptionCreateBody: trial 2 hours away or null -> no start_at", () => {
  const soon = new Date(NOW.getTime() + 2 * 3600_000).toISOString();
  assert.equal("start_at" in subscriptionCreateBody(RAZORPAY_ENV, { businessId: BUSINESS, interval: "month", trialEndsAt: soon }, NOW), false);
  assert.equal("start_at" in subscriptionCreateBody(RAZORPAY_ENV, { businessId: BUSINESS, interval: "month", trialEndsAt: null }, NOW), false);
  assert.equal(MIN_START_LEAD_MS, 24 * 3600_000);
  assert.deepEqual(RAZORPAY_MAX_COUNT, { month: 120, year: 10 });
});

test("subscriptionCreateBody: a missing plan variable is billing not set up", () => {
  assert.throws(() => subscriptionCreateBody({}, { businessId: BUSINESS, interval: "month", trialEndsAt: null }, NOW), new Error(BILLING_NOT_SET_UP));
});

// --- Razorpay REST (stub fetch) -----------------------------------------------------------------

function stubFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    return new Response(JSON.stringify(next.json ?? {}), { status: next.status ?? 200 });
  };
  return { calls, fetchImpl };
}

test("razorpayRequest: basic auth, base url, JSON body", async () => {
  const { calls, fetchImpl } = stubFetch([{ json: { id: "sub_1" } }]);
  const result = await razorpayRequest(RAZORPAY_ENV, "POST", "/subscriptions", { a: 1 }, fetchImpl);
  assert.deepEqual(result, { status: 200, json: { id: "sub_1" } });
  assert.equal(calls[0].url, "https://api.razorpay.com/v1/subscriptions");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.authorization, `Basic ${Buffer.from("rzp_test_id:secret").toString("base64")}`);
  assert.equal(calls[0].init.body, JSON.stringify({ a: 1 }));
});

test("razorpay provider: startCheckout posts the body and returns the subscription id and key id", async () => {
  const { calls, fetchImpl } = stubFetch([{ json: { id: "sub_NEW" } }]);
  const provider = razorpayProvider(RAZORPAY_ENV, fetchImpl);
  const result = await provider.startCheckout({ businessId: BUSINESS, interval: "month", trialEndsAt: null, origin: "https://x.example" });
  assert.deepEqual(result, { kind: "razorpay", subscriptionId: "sub_NEW", keyId: "rzp_test_id" });
  assert.equal(JSON.parse(calls[0].init.body).notes.business_id, BUSINESS);
});

test("razorpay provider: getSubscription maps 404 and 'does not exist' to null, other failures throw", async () => {
  const provider = (responses) => razorpayProvider(RAZORPAY_ENV, stubFetch(responses).fetchImpl);
  assert.equal(await provider([{ status: 404 }]).getSubscription("sub_x"), null);
  assert.equal(await provider([{ status: 400, json: { error: { description: "The id provided does not exist" } } }]).getSubscription("sub_x"), null);
  await assert.rejects(() => provider([{ status: 500 }]).getSubscription("sub_x"));
  await assert.rejects(() => provider([{ status: 400, json: { error: { description: "Bad thing" } } }]).getSubscription("sub_x"));
  const snap = await provider([{ json: { id: "sub_x", status: "active", current_end: 1795000000, notes: {} } }]).getSubscription("sub_x");
  assert.equal(snap.exists, true);
  assert.equal(snap.status, "active");
});

test("razorpay provider: updateCardUrl returns short_url", async () => {
  const { calls, fetchImpl } = stubFetch([{ json: { id: "sub_x", short_url: "https://rzp.io/i/abc" } }, { json: { id: "sub_x" } }]);
  const provider = razorpayProvider(RAZORPAY_ENV, fetchImpl);
  assert.equal(await provider.updateCardUrl("sub_x", "https://x.example"), "https://rzp.io/i/abc");
  assert.equal(calls[0].url, "https://api.razorpay.com/v1/subscriptions/sub_x");
  await assert.rejects(() => provider.updateCardUrl("sub_x", "https://x.example"));
});

test("razorpay provider: cancel sends cancel_at_cycle_end, and 'already cancelled' counts as success", async () => {
  const { calls, fetchImpl } = stubFetch([
    { json: { status: "cancelled" } },
    { json: { status: "active" } },
    { status: 400, json: { error: { description: "Subscription is not cancellable in cancelled status." } } },
    { status: 400, json: { error: { description: "Something else" } } },
  ]);
  const provider = razorpayProvider(RAZORPAY_ENV, fetchImpl);
  await provider.cancel({ businessId: BUSINESS, subscriptionId: "sub_x", atPeriodEnd: true });
  await provider.cancel({ businessId: BUSINESS, subscriptionId: "sub_x", atPeriodEnd: false });
  assert.equal(calls[0].url, "https://api.razorpay.com/v1/subscriptions/sub_x/cancel");
  assert.deepEqual(JSON.parse(calls[0].init.body), { cancel_at_cycle_end: 1 });
  assert.deepEqual(JSON.parse(calls[1].init.body), { cancel_at_cycle_end: 0 });
  await provider.cancel({ businessId: BUSINESS, subscriptionId: "sub_x", atPeriodEnd: false });
  await assert.rejects(() => provider.cancel({ businessId: BUSINESS, subscriptionId: "sub_x", atPeriodEnd: false }));
});

test("pretend provider: redirect checkout, portal url, cancel at period end does nothing", async () => {
  const pretend = billingProvider({ NODE_ENV: "development" }, FILLED);
  assert.deepEqual(await pretend.startCheckout({ businessId: BUSINESS, interval: "year", trialEndsAt: null, origin: "https://x.example" }), {
    kind: "redirect", url: "/billing/pretend?interval=year",
  });
  assert.equal(await pretend.updateCardUrl("pretend_sub_x", "https://x.example"), "/billing/pretend/portal");
  await pretend.cancel({ businessId: BUSINESS, subscriptionId: "pretend_sub_x", atPeriodEnd: true });
});

// --- cancel decision ----------------------------------------------------------------------------

const owner = (over) => ({
  subscriptionId: "sub_1", status: "active", cancelAt: null, currentPeriodEnd: "2026-11-25T10:00:00.000Z", hasPaymentMethod: true, ...over,
});

test("cancelDecision: already cancelling -> 409 with the date", () => {
  assert.deepEqual(cancelDecision(owner({ cancelAt: "2026-11-25T10:00:00.000Z" })), {
    action: "refuse", status: 409, error: "This subscription already ends on 25 Nov 2026.",
  });
});

test("cancelDecision: no subscription or canceled -> 409", () => {
  assert.equal(cancelDecision(owner({ subscriptionId: null })).action, "refuse");
  assert.equal(cancelDecision(owner({ subscriptionId: null })).status, 409);
  assert.equal(cancelDecision(owner({ status: "canceled" })).action, "refuse");
  assert.equal(cancelDecision(owner({ status: "canceled" })).status, 409);
});

test("cancelDecision: trialing with a card removes the card; active and past_due cancel at period end", () => {
  assert.deepEqual(cancelDecision(owner({ status: "trialing" })), { action: "remove_trial_card" });
  assert.deepEqual(cancelDecision(owner({ status: "active" })), { action: "cancel_at_period_end", cancelAt: "2026-11-25T10:00:00.000Z" });
  assert.deepEqual(cancelDecision(owner({ status: "past_due" })), { action: "cancel_at_period_end", cancelAt: "2026-11-25T10:00:00.000Z" });
});

// --- webhook handler ----------------------------------------------------------------------------

const SECRET = "whsec_test";
function signedRequest(name, eventId = "evt_1") {
  const raw = readFileSync(new URL(`./fixtures/razorpay/${name}.json`, import.meta.url), "utf8");
  const signature = createHmac("sha256", SECRET).update(raw).digest("hex");
  return new Request("https://x.example/api/v1/billing/webhook", {
    method: "POST", body: raw, headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": eventId },
  });
}

test("webhook cancels a superseded subscription", async () => {
  const cancels = [];
  const deps = {
    secret: SECRET,
    applyEvent: async () => "superseded",
    provider: () => ({ cancel: async (input) => { cancels.push(input); } }),
  };
  const response = await handleRazorpayWebhook(signedRequest("activated"), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { result: "superseded" });
  assert.equal(cancels.length, 1);
  assert.equal(cancels[0].atPeriodEnd, false);
  assert.equal(cancels[0].subscriptionId, "sub_TEST1");
  assert.equal(cancels[0].businessId, BUSINESS);
});

test("webhook: a failing superseded cancel answers 500 so Razorpay redelivers", async () => {
  const deps = {
    secret: SECRET,
    applyEvent: async () => "superseded",
    provider: () => ({ cancel: async () => { throw new Error("razorpay down"); } }),
  };
  assert.equal((await handleRazorpayWebhook(signedRequest("activated"), deps)).status, 500);
});

test("webhook: applied events do not cancel; bad signature is 400; no secret is 503", async () => {
  let cancelled = 0;
  const deps = { secret: SECRET, applyEvent: async () => "applied", provider: () => ({ cancel: async () => { cancelled += 1; } }) };
  const ok = await handleRazorpayWebhook(signedRequest("activated"), deps);
  assert.deepEqual(await ok.json(), { result: "applied" });
  assert.equal(cancelled, 0);
  assert.equal((await handleRazorpayWebhook(signedRequest("activated"), { ...deps, secret: "other" })).status, 400);
  assert.equal((await handleRazorpayWebhook(signedRequest("activated"), { ...deps, secret: undefined })).status, 503);
});

// --- cancel ordering ----------------------------------------------------------------------------

function cancelHarness({ providerFails = false, recordFails = false } = {}) {
  const log = [];
  const deps = {
    provider: { cancel: async (input) => { log.push(["provider", input.atPeriodEnd]); if (providerFails) throw new Error("down"); } },
    recordCancel: async (args) => { log.push(["record", args.cancelAt]); return { error: recordFails ? new Error("rpc") : null }; },
    clearCancelAt: async () => { log.push(["clear"]); return { error: null }; },
  };
  return { log, deps };
}
const CANCEL_INPUT = { businessId: BUSINESS, subscriptionId: "sub_1", userId: "u1" };
const PERIOD = { action: "cancel_at_period_end", cancelAt: "2026-11-25T10:00:00.000Z" };

test("runCancel: records before the provider call", async () => {
  const { log, deps } = cancelHarness();
  const outcome = await runCancel(PERIOD, CANCEL_INPUT, deps);
  assert.deepEqual(outcome, { ok: true, cancelAt: PERIOD.cancelAt });
  assert.deepEqual(log, [["record", PERIOD.cancelAt], ["provider", true]]);
});

test("runCancel: a provider failure on the period-end path clears cancel_at and returns 502", async () => {
  const { log, deps } = cancelHarness({ providerFails: true });
  const outcome = await runCancel(PERIOD, CANCEL_INPUT, deps);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.status, 502);
  assert.deepEqual(log, [["record", PERIOD.cancelAt], ["provider", true], ["clear"]]);
});

test("runCancel: a record failure never calls the provider", async () => {
  const { log, deps } = cancelHarness({ recordFails: true });
  assert.equal((await runCancel(PERIOD, CANCEL_INPUT, deps)).ok, false);
  assert.deepEqual(log, [["record", PERIOD.cancelAt]]);
});

test("runCancel: the trial path never records a cancel_at, cancels at once, and 502s on failure", async () => {
  const ok = cancelHarness();
  assert.deepEqual(await runCancel({ action: "remove_trial_card" }, CANCEL_INPUT, ok.deps), { ok: true, cancelAt: null });
  assert.deepEqual(ok.log, [["record", null], ["provider", false]]);
  const bad = cancelHarness({ providerFails: true });
  const outcome = await runCancel({ action: "remove_trial_card" }, CANCEL_INPUT, bad.deps);
  assert.equal(outcome.status, 502);
  assert.deepEqual(bad.log, [["record", null], ["provider", false]]);
});
