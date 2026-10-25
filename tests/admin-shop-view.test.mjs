import assert from "node:assert/strict";
import test from "node:test";
import { adminDateTime, isShopId, overrideActive, searchFilter, shopStatusText, tillsLine } from "../lib/admin/shop-view.ts";

const now = new Date("2026-10-19T10:00:00Z"); // 14:00 in Dubai
const base = {
  planId: "starter", status: "active", access: "full", trialEndsAt: null, graceEndsAt: null, accessEndsAt: null,
  cancelAt: null, hasPaymentMethod: true, billingInterval: "month", currentPeriodEnd: "2026-11-19T10:00:00Z", features: [],
  limits: { branches: 1, tills: 1, members: 3, products: null },
};

test("tillsLine counts against the effective limit", () => {
  assert.equal(tillsLine(2, 3), "2 of 3 allowed");
  assert.equal(tillsLine(0, 1), "0 of 1 allowed");
  assert.equal(tillsLine(2, null), "2 (no limit)");
});

test("shopStatusText reuses the billing summary", () => {
  const trial = { ...base, planId: "pro", status: "trialing", trialEndsAt: "2026-10-25T09:00:00Z", accessEndsAt: "2026-10-25T09:00:00Z", hasPaymentMethod: false };
  assert.equal(shopStatusText(trial, now), "Pro trial · 6 days left");
  assert.equal(shopStatusText({ ...base, status: "past_due", graceEndsAt: "2026-10-26T09:00:00Z", accessEndsAt: "2026-10-26T09:00:00Z" }, now), "Payment failed · grace ends 26 Oct");
  assert.equal(shopStatusText({ ...base, status: "canceled", access: "read_only", accessEndsAt: "2026-10-01T00:00:00Z" }, now), "Read-only since 1 Oct");
  assert.equal(shopStatusText(base, now), "Starter · monthly · renews 19 Nov 2026");
});

test("isShopId accepts only a uuid", () => {
  assert.equal(isShopId("6f1c2d3e-4b5a-4c6d-8e7f-001122334455"), true);
  assert.equal(isShopId("6F1C2D3E-4B5A-4C6D-8E7F-001122334455"), true);
  assert.equal(isShopId("not-a-uuid"), false);
  assert.equal(isShopId(""), false);
});

test("searchFilter quotes the term so commas and brackets cannot break the filter", () => {
  assert.equal(searchFilter("Al Noor", []), 'legal_name.ilike."%Al Noor%",trn.ilike."%Al Noor%"');
  assert.equal(searchFilter('a,b) "x" 50%*\\', []), 'legal_name.ilike."%a,b) x 50%",trn.ilike."%a,b) x 50%"');
  assert.equal(searchFilter("x", ["u1", "u2"]), 'legal_name.ilike."%x%",trn.ilike."%x%",owner_id.in.(u1,u2)');
  const id = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";
  assert.equal(searchFilter(` ${id} `, []), `legal_name.ilike."%${id}%",trn.ilike."%${id}%",id.eq.${id}`);
});

test("searchFilter is null for an empty or wildcard-only term", () => {
  assert.equal(searchFilter("   ", []), null);
  assert.equal(searchFilter("%*", []), null);
});

test("overrideActive: no expiry or a future expiry", () => {
  assert.equal(overrideActive(null, now), true);
  assert.equal(overrideActive("2026-10-20T00:00:00Z", now), true);
  assert.equal(overrideActive("2026-10-19T10:00:00Z", now), false);
  assert.equal(overrideActive("2026-10-01T00:00:00Z", now), false);
});

test("adminDateTime shows Dubai time and a dash for none", () => {
  assert.equal(adminDateTime("2026-10-19T10:00:00Z"), "19 Oct 2026, 14:00");
  assert.equal(adminDateTime(null), "—");
  assert.equal(adminDateTime("garbage"), "—");
});
