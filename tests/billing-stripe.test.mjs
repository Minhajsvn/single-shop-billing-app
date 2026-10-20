import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import Stripe from "stripe";
import { normalizeStripeEvent, verifyStripeEvent } from "../lib/billing/stripe-events.ts";
import { billingProvider, checkoutSessionParams, checkoutTrialEnd } from "../lib/billing/provider.ts";
import { applyBillingEvent, BillingEventError, webhookStatus } from "../lib/billing/apply-event.ts";
import { ownerGuard } from "../lib/billing/owner-guard.ts";

const BUSINESS = "11111111-1111-4111-8111-111111111111";
const fixtureText = (name) => readFileSync(new URL(`./fixtures/stripe/${name}.json`, import.meta.url), "utf8");
const fixture = (name) => JSON.parse(fixtureText(name));
const iso = (seconds) => new Date(seconds * 1000).toISOString();

const STRIPE_ENV = {
  STRIPE_SECRET_KEY: "sk_test_placeholder",
  STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
  STRIPE_PRICE_STARTER_MONTHLY: "price_test_starter_monthly",
  STRIPE_PRICE_STARTER_ANNUAL: "price_test_starter_annual",
};

test("normalises the checkout session with its business id", () => {
  const event = normalizeStripeEvent(fixture("checkout.session.completed"));
  assert.deepEqual(event, {
    id: "evt_test_checkout_1",
    created: iso(1792454400),
    kind: "checkout_completed",
    businessId: BUSINESS,
    customerId: "cus_test_1",
    subscriptionId: "sub_test_1",
    status: "trialing",
    trialEnd: null,
    currentPeriodEnd: null,
    cancelAt: null,
    interval: "month",
  });
});

test("a paid checkout session (no trial) reports active", () => {
  const raw = fixture("checkout.session.completed");
  raw.data.object.payment_status = "paid";
  raw.data.object.client_reference_id = null;
  const event = normalizeStripeEvent(raw);
  assert.equal(event.status, "active");
  assert.equal(event.businessId, BUSINESS, "falls back to metadata.business_id");
});

test("subscription active carries the item period end, interval and business id", () => {
  const event = normalizeStripeEvent(fixture("customer.subscription.updated.active"));
  assert.equal(event.kind, "subscription_changed");
  assert.equal(event.status, "active");
  assert.equal(event.businessId, BUSINESS);
  assert.equal(event.subscriptionId, "sub_test_1");
  assert.equal(event.currentPeriodEnd, iso(1795737600));
  assert.equal(event.trialEnd, iso(1793059200));
  assert.equal(event.cancelAt, null);
  assert.equal(event.interval, "month");
});

test("subscription past_due becomes subscription_changed with status past_due", () => {
  const event = normalizeStripeEvent(fixture("customer.subscription.updated.past_due"));
  assert.equal(event.kind, "subscription_changed");
  assert.equal(event.status, "past_due");
  assert.equal(event.customerId, "cus_test_1");
});

test("cancel_at_period_end keeps the cancel date", () => {
  const event = normalizeStripeEvent(fixture("customer.subscription.updated.cancel_at_period_end"));
  assert.equal(event.cancelAt, iso(1795737600));
  assert.equal(event.interval, "year");
  const raw = fixture("customer.subscription.updated.cancel_at_period_end");
  raw.data.object.cancel_at = null; // older shape: only the flag is set
  assert.equal(normalizeStripeEvent(raw).cancelAt, iso(1795737600));
});

test("subscription deleted becomes subscription_deleted", () => {
  const event = normalizeStripeEvent(fixture("customer.subscription.deleted"));
  assert.equal(event.kind, "subscription_deleted");
  assert.equal(event.status, "canceled");
  assert.equal(event.businessId, BUSINESS);
});

test("zero-amount trial invoice is ignored", () => {
  assert.equal(normalizeStripeEvent(fixture("invoice.paid.trial")), null);
});

test("a paid invoice carries its subscription, business id and line period end", () => {
  const event = normalizeStripeEvent(fixture("invoice.paid"));
  assert.equal(event.kind, "invoice_paid");
  assert.equal(event.subscriptionId, "sub_test_1");
  assert.equal(event.customerId, "cus_test_1");
  assert.equal(event.businessId, BUSINESS);
  assert.equal(event.currentPeriodEnd, iso(1795737600));
  assert.equal(event.status, null);
});

test("a failed invoice becomes payment_failed", () => {
  const event = normalizeStripeEvent(fixture("invoice.payment_failed"));
  assert.equal(event.kind, "payment_failed");
  assert.equal(event.subscriptionId, "sub_test_1");
});

test("unknown event types are ignored", () => {
  assert.equal(normalizeStripeEvent({ id: "evt_test_x", type: "customer.created", created: 1792454400, data: { object: { id: "cus_test_1" } } }), null);
  const oneTime = fixture("checkout.session.completed");
  oneTime.data.object.mode = "payment";
  assert.equal(normalizeStripeEvent(oneTime), null, "non-subscription checkouts are ignored");
});

test("webhook signature: a fixture signed with the test secret verifies; a tampered body fails", () => {
  const secret = `whsec_${randomBytes(24).toString("hex")}`;
  const payload = fixtureText("invoice.paid");
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  const event = verifyStripeEvent(payload, header, secret);
  assert.equal(event.id, "evt_test_invoice_paid_1");
  assert.equal(normalizeStripeEvent(event).kind, "invoice_paid");
  const tampered = payload.replace("10395", "1");
  assert.throws(() => verifyStripeEvent(tampered, header, secret));
  assert.throws(() => verifyStripeEvent(payload, header, `whsec_${randomBytes(24).toString("hex")}`));
});

test("provider: pretend without keys in development, none in production, stripe when all four variables are set", () => {
  assert.equal(billingProvider({ NODE_ENV: "development" }).kind, "pretend");
  assert.equal(billingProvider({ NODE_ENV: "test" }).kind, "pretend");
  assert.equal(billingProvider({ NODE_ENV: "production" }).kind, "none");
  assert.equal(billingProvider({ NODE_ENV: "production", ...STRIPE_ENV }).kind, "stripe");
  assert.equal(billingProvider({ NODE_ENV: "development", ...STRIPE_ENV }).kind, "stripe");
  const partial = { ...STRIPE_ENV, STRIPE_PRICE_STARTER_ANNUAL: "" };
  assert.equal(billingProvider({ NODE_ENV: "production", ...partial }).kind, "none");
  assert.equal(billingProvider({ NODE_ENV: "development", ...partial }).kind, "pretend");
});

test("pretend provider returns the pretend checkout and portal pages", async () => {
  const provider = billingProvider({ NODE_ENV: "development" });
  const checkout = new URL(await provider.startCheckout({ businessId: BUSINESS, customerId: null, interval: "year", trialEndsAt: null, origin: "http://localhost:3000" }));
  assert.equal(checkout.pathname, "/billing/pretend");
  assert.equal(checkout.searchParams.get("interval"), "year");
  const portal = new URL(await provider.openPortal({ customerId: "cus_test_1", origin: "http://localhost:3000" }));
  assert.equal(portal.pathname, "/billing/pretend/portal");
  await assert.rejects(billingProvider({ NODE_ENV: "production" }).startCheckout({ businessId: BUSINESS, customerId: null, interval: "month", trialEndsAt: null, origin: "http://x" }));
});

test("trial_end is passed only when the trial has more than 48 hours left", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  const hours = (h) => new Date(now.getTime() + h * 3600_000).toISOString();
  assert.equal(checkoutTrialEnd(hours(49), now), Math.floor(Date.parse(hours(49)) / 1000));
  assert.equal(checkoutTrialEnd(hours(48), now), null);
  assert.equal(checkoutTrialEnd(hours(2), now), null);
  assert.equal(checkoutTrialEnd(hours(-5), now), null);
  assert.equal(checkoutTrialEnd(null, now), null);
  assert.equal(checkoutTrialEnd("not a date", now), null);
});

test("checkout session params follow the brief", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  const trialEndsAt = "2026-10-27T00:00:00.000Z";
  const params = checkoutSessionParams(STRIPE_ENV, { businessId: BUSINESS, customerId: "cus_test_1", interval: "year", trialEndsAt, origin: "http://localhost:3000" }, now);
  assert.equal(params.mode, "subscription");
  assert.deepEqual(params.line_items, [{ price: "price_test_starter_annual", quantity: 1 }]);
  assert.equal(params.client_reference_id, BUSINESS);
  assert.equal(params.customer, "cus_test_1");
  assert.deepEqual(params.automatic_tax, { enabled: true });
  assert.equal(params.subscription_data.metadata.business_id, BUSINESS);
  assert.equal(params.subscription_data.trial_end, Math.floor(Date.parse(trialEndsAt) / 1000));
  assert.equal(params.success_url, "http://localhost:3000/settings?tab=billing&checkout=success");
  assert.equal(params.cancel_url, "http://localhost:3000/settings?tab=billing&checkout=cancel");

  const late = checkoutSessionParams(STRIPE_ENV, { businessId: BUSINESS, customerId: null, interval: "month", trialEndsAt: "2026-10-21T00:00:00Z", origin: "http://localhost:3000" }, now);
  assert.deepEqual(late.line_items, [{ price: "price_test_starter_monthly", quantity: 1 }]);
  assert.equal(late.subscription_data.trial_end, undefined);
  assert.equal("customer" in late, false);
});

test("applyBillingEvent passes the RPC result through and classifies errors", async () => {
  const event = normalizeStripeEvent(fixture("invoice.paid"));
  const calls = [];
  const client = (result) => ({ rpc: async (name, args) => { calls.push([name, args]); return result; } });
  assert.equal(await applyBillingEvent(event, client({ data: "duplicate", error: null })), "duplicate");
  assert.deepEqual(calls[0], ["apply_billing_event", { p_event: event }]);

  const malformed = await applyBillingEvent(event, client({ data: null, error: { code: "22P02", message: "invalid input syntax for type uuid" } })).catch((e) => e);
  assert.ok(malformed instanceof BillingEventError);
  assert.equal(malformed.permanent, true);
  const down = await applyBillingEvent(event, client({ data: null, error: { code: "", message: "fetch failed" } })).catch((e) => e);
  assert.equal(down.permanent, false);
  const odd = await applyBillingEvent(event, client({ data: "something", error: null })).catch((e) => e);
  assert.equal(odd.permanent, false);
});

test("webhook status: unknown_business is retried, the rest are 200", () => {
  assert.equal(webhookStatus("applied"), 200);
  assert.equal(webhookStatus("duplicate"), 200);
  assert.equal(webhookStatus("stale"), 200);
  assert.equal(webhookStatus("unknown_business"), 409);
});

test("owner guard: only an active owner passes; a cashier gets 403", () => {
  const user = { id: "u1" };
  assert.equal(ownerGuard(user, { business_id: BUSINESS, role: "owner", status: "active" }), null);
  assert.equal(ownerGuard(user, { business_id: BUSINESS, role: "cashier", status: "active" })?.status, 403);
  assert.equal(ownerGuard(user, { business_id: BUSINESS, role: "owner", status: "invited" })?.status, 403);
  assert.equal(ownerGuard(user, null)?.status, 403);
  assert.equal(ownerGuard(null, null)?.status, 401);
});
