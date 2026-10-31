import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeRazorpayEvent, subscriptionSnapshot, verifyRazorpaySignature } from "../lib/billing/razorpay-events.ts";
import { applyBillingEvent, BillingEventError, webhookStatus } from "../lib/billing/apply-event.ts";
import { ownerGuard } from "../lib/billing/owner-guard.ts";
import { isPretendAction, pretendEvent } from "../lib/billing/pretend-events.ts";

const BUSINESS = "11111111-1111-4111-8111-111111111111";
const fixtureText = (name) => readFileSync(new URL(`./fixtures/razorpay/${name}.json`, import.meta.url), "utf8");
const fixture = (name) => JSON.parse(fixtureText(name));
const iso = (seconds) => new Date(seconds * 1000).toISOString();
const CREATED = 1792454400;
const DAY = 86400;
const normalize = (name, id = `evt_${name}`) => normalizeRazorpayEvent(id, fixture(name));

test("signature: valid passes; wrong secret, tampered body, missing header and wrong length fail", () => {
  const secret = "whsec_test_placeholder";
  const raw = fixtureText("charged");
  const good = createHmac("sha256", secret).update(raw).digest("hex");
  assert.equal(verifyRazorpaySignature(raw, good, secret), true);
  assert.equal(verifyRazorpaySignature(raw, good, "another-secret"), false);
  assert.equal(verifyRazorpaySignature(raw.replace("sub_TEST1", "sub_TEST2"), good, secret), false);
  assert.equal(verifyRazorpaySignature(raw, null, secret), false);
  assert.equal(verifyRazorpaySignature(raw, good.slice(0, -2), secret), false);
  assert.equal(verifyRazorpaySignature(raw, `${good}00`, secret), false);
});

const PERIOD_END = iso(CREATED + 30 * DAY);
const START = iso(CREATED - 60);

const expectEvent = (name, expected) => {
  const event = normalize(name);
  assert.ok(event, name);
  assert.equal(event.id, `evt_${name}`);
  assert.equal(event.created, iso(CREATED));
  assert.equal(event.kind, expected.kind);
  assert.equal(event.status, expected.status);
  assert.equal(event.subscriptionId, "sub_TEST1");
  assert.equal(event.customerId, "cust_TEST1");
  assert.equal(event.businessId, BUSINESS);
  assert.equal(event.interval, "month");
  assert.equal(event.cancelAt, null);
  assert.equal(event.currentPeriodEnd, expected.currentPeriodEnd ?? null);
  assert.equal(event.trialEnd, expected.trialEnd ?? null);
};

test("authenticated with a future start_at is a trialing checkout", () => {
  expectEvent("authenticated.trial", { kind: "checkout_completed", status: "trialing", trialEnd: iso(CREATED + 5 * DAY) });
});

test("authenticated without a future start_at is ignored (null)", () => {
  assert.equal(normalize("authenticated.now"), null);
});

test("activated is an active checkout", () => {
  expectEvent("activated", { kind: "checkout_completed", status: "active", currentPeriodEnd: PERIOD_END, trialEnd: START });
});

test("charged is invoice_paid / active", () => {
  expectEvent("charged", { kind: "invoice_paid", status: "active", currentPeriodEnd: PERIOD_END, trialEnd: START });
});

test("pending and halted are payment_failed / past_due", () => {
  expectEvent("pending", { kind: "payment_failed", status: "past_due", currentPeriodEnd: PERIOD_END, trialEnd: START });
  expectEvent("halted", { kind: "payment_failed", status: "past_due", currentPeriodEnd: PERIOD_END, trialEnd: START });
});

test("cancelled after payment is subscription_deleted / canceled", () => {
  expectEvent("cancelled.paid", { kind: "subscription_deleted", status: "canceled", currentPeriodEnd: PERIOD_END, trialEnd: START });
});

test("cancelled before the first charge, with start_at in the future, is trial_card_removed", () => {
  expectEvent("cancelled.trial", { kind: "trial_card_removed", status: "canceled", trialEnd: iso(CREATED + 5 * DAY) });
});

test("completed (and expired) are subscription_deleted / canceled", () => {
  expectEvent("completed", { kind: "subscription_deleted", status: "canceled", currentPeriodEnd: PERIOD_END, trialEnd: START });
  const expired = { ...fixture("completed"), event: "subscription.expired" };
  assert.equal(normalizeRazorpayEvent("evt_x", expired).kind, "subscription_deleted");
});

test("updated is ignored (null)", () => {
  assert.equal(normalize("updated"), null);
});

test("a missing notes.business_id gives businessId null", () => {
  const body = fixture("charged");
  delete body.payload.subscription.entity.notes;
  const event = normalizeRazorpayEvent("evt_x", body);
  assert.equal(event.businessId, null);
  assert.equal(event.interval, null);
});

test("an event without a subscription entity or event id is ignored", () => {
  assert.equal(normalizeRazorpayEvent("evt_x", { event: "subscription.charged", created_at: CREATED, payload: {} }), null);
  assert.equal(normalizeRazorpayEvent("", fixture("charged")), null);
});

test("subscriptionSnapshot: status, currentPeriodEnd, trialEnd only while authenticated, cancelAt null, exists true", () => {
  const trial = subscriptionSnapshot(fixture("authenticated.trial").payload.subscription.entity);
  assert.deepEqual(trial, { exists: true, status: "authenticated", currentPeriodEnd: null, cancelAt: null, trialEnd: iso(CREATED + 5 * DAY) });
  const active = subscriptionSnapshot(fixture("charged").payload.subscription.entity);
  assert.deepEqual(active, { exists: true, status: "active", currentPeriodEnd: PERIOD_END, cancelAt: null, trialEnd: null });
});

test("applyBillingEvent passes the RPC result through and classifies errors", async () => {
  const event = normalize("charged");
  const calls = [];
  const client = (result) => ({ rpc: async (name, args) => { calls.push([name, args]); return result; } });
  assert.equal(await applyBillingEvent(event, client({ data: "duplicate", error: null })), "duplicate");
  assert.equal(await applyBillingEvent(event, client({ data: "superseded", error: null })), "superseded");
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
  assert.equal(webhookStatus("superseded"), 200);
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

const PRETEND_CTX = { businessId: BUSINESS, interval: "month", now: new Date("2026-10-20T10:00:00Z"), trialEndsAt: "2026-10-30T10:00:00Z" };

test("pretend: pay during the trial emits checkout_completed only", () => {
  const events = pretendEvent("pay", PRETEND_CTX);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "checkout_completed");
  assert.equal(events[0].status, "trialing");
  assert.equal(events[0].customerId, `pretend_cus_${BUSINESS}`);
  assert.equal(events[0].subscriptionId, `pretend_sub_${BUSINESS}`);
  assert.match(events[0].id, /^pretend_[0-9a-f-]{36}$/);
  assert.deepEqual(pretendEvent("decline", PRETEND_CTX), []);
  assert.equal(pretendEvent("pay", { ...PRETEND_CTX, trialEndsAt: null })[0].status, "active");
});

test("pretend: fail_renewal emits payment_failed", () => {
  assert.deepEqual(pretendEvent("fail_renewal", PRETEND_CTX).map((e) => e.kind), ["payment_failed"]);
  assert.deepEqual(pretendEvent("update_card", PRETEND_CTX).map((e) => e.kind), ["invoice_paid"]);
  assert.deepEqual(pretendEvent("end_trial", PRETEND_CTX), []);
  assert.deepEqual(pretendEvent("end_trial", { ...PRETEND_CTX, hasPaymentMethod: true }).map((e) => e.kind), ["invoice_paid"]);
  assert.deepEqual(pretendEvent("end_grace", PRETEND_CTX), []);
});

test("pretend: cancel then renew emits subscription_deleted", () => {
  const [cancel] = pretendEvent("cancel", { ...PRETEND_CTX, currentPeriodEnd: "2026-11-20T10:00:00.000Z" });
  assert.equal(cancel.kind, "subscription_changed");
  assert.equal(cancel.cancelAt, "2026-11-20T10:00:00.000Z");
  const renewed = pretendEvent("renew", { ...PRETEND_CTX, cancelAt: cancel.cancelAt });
  assert.deepEqual(renewed.map((e) => e.kind), ["subscription_deleted"]);
  assert.deepEqual(pretendEvent("renew", PRETEND_CTX).map((e) => e.kind), ["invoice_paid"]);
  assert.equal(isPretendAction("pay"), true);
  assert.equal(isPretendAction("refund"), false);
});
