import assert from "node:assert/strict";
import test from "node:test";
import {
  OWNER_ID_CAP, adminDateTime, emailNeedle, isShopId, matchingOwnerIds, overrideActive, pageWindow, searchFilter, searchTerm, shopStatusText, tillsLine,
} from "../lib/admin/shop-view.ts";

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

test("shopStatusText names a paid Pro shop as Pro", () => {
  assert.equal(shopStatusText({ ...base, planId: "pro" }, now), "Pro · monthly · renews 19 Nov 2026");
});

test("searchTerm cleans the query once: wildcards, quotes and backslashes dropped, trimmed, at most 200 chars", () => {
  assert.equal(searchTerm('  a "b" 5%*\\ '), "a b 5");
  assert.equal(searchTerm("%*"), "");
  assert.equal(searchTerm("x".repeat(250)).length, 200);
});

test("emailNeedle skips email search for terms shorter than 3 characters", () => {
  assert.equal(emailNeedle(""), null);
  assert.equal(emailNeedle("ab"), null);
  assert.equal(emailNeedle("Com"), "com");
  assert.equal(emailNeedle("Plain-Owner@x"), "plain-owner@x");
});

test("matchingOwnerIds keeps only shop owners and caps the list", () => {
  const owners = new Set(["u1", "u3"]);
  assert.deepEqual(matchingOwnerIds(["u1", "u2", "u3"], owners), ["u1", "u3"]);
  const many = Array.from({ length: 300 }, (_, i) => `u${i}`);
  const capped = matchingOwnerIds(many, new Set(many));
  assert.equal(capped.length, OWNER_ID_CAP);
  assert.equal(OWNER_ID_CAP, 200);
  assert.deepEqual(matchingOwnerIds(["u1", "u1"], owners), ["u1"]);
});

test("pageWindow clamps the page into range and gives the offset", () => {
  assert.deepEqual(pageWindow(1, 0, 50), { page: 1, pages: 1, from: 0 });
  assert.deepEqual(pageWindow(99, 120, 50), { page: 3, pages: 3, from: 100 });
  assert.deepEqual(pageWindow(2, 120, 50), { page: 2, pages: 3, from: 50 });
  assert.deepEqual(pageWindow(0, 120, 50), { page: 1, pages: 3, from: 0 });
  assert.deepEqual(pageWindow(Number.NaN, 100, 50), { page: 1, pages: 2, from: 0 });
  assert.deepEqual(pageWindow(5, 100, 50), { page: 2, pages: 2, from: 50 });
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
