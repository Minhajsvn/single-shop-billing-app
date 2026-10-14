import assert from "node:assert/strict";
import test from "node:test";
import { READ_ONLY_ENTITLEMENTS, hasFeature, parseEntitlements } from "../lib/billing/entitlements.ts";
import { ENTITLEMENT_TOKEN_TTL_HOURS, signEntitlements, verifyEntitlements } from "../lib/billing/entitlement-token.ts";

const raw = {
  planId: "pro", status: "trialing", access: "full", trialEndsAt: "2026-10-27T00:00:00+00:00", graceEndsAt: null,
  features: ["serial_tracking", "staff_roles"], limits: { branches: 1, tills: 2, members: 5, products: null },
};
const secret = "test-secret-at-least-32-characters-long!!";
const now = new Date("2026-10-13T10:00:00Z");

test("parses the SQL resolver payload", () => {
  const e = parseEntitlements(raw);
  assert.equal(e.limits.products, null);
  assert.equal(hasFeature(e, "serial_tracking"), true);
  assert.equal(hasFeature(e, "repairs"), false);
});

test("rejects malformed payloads and unknown features", () => {
  assert.throws(() => parseEntitlements({ ...raw, access: "maybe" }));
  assert.throws(() => parseEntitlements({ ...raw, features: ["teleport"] }));
});

test("read-only access disables every feature", () => {
  assert.equal(hasFeature({ ...parseEntitlements(raw), access: "read_only" }, "serial_tracking"), false);
  assert.equal(READ_ONLY_ENTITLEMENTS.access, "read_only");
});

test("tokens round-trip, expire after 72h, and detect tampering", () => {
  const { token, expiresAt } = signEntitlements(parseEntitlements(raw), "biz-1", secret, now);
  assert.equal(new Date(expiresAt).getTime() - now.getTime(), ENTITLEMENT_TOKEN_TTL_HOURS * 3600_000);
  assert.equal(verifyEntitlements(token, secret, now)?.businessId, "biz-1");
  assert.equal(verifyEntitlements(token, secret, new Date(now.getTime() + 72 * 3600_000)), null, "expired exactly at TTL");
  assert.equal(verifyEntitlements(token, "another-secret-of-sufficient-length!!", now), null, "wrong secret");
  const [body, signature] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), businessId: "biz-2" })).toString("base64url");
  assert.equal(verifyEntitlements(`${forged}.${signature}`, secret, now), null, "tampered body");
  assert.equal(verifyEntitlements("garbage", secret, now), null);
});

test("refuses short secrets", () => {
  assert.throws(() => signEntitlements(parseEntitlements(raw), "biz-1", "short", now), RangeError);
});
