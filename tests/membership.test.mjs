import assert from "node:assert/strict";
import test from "node:test";
import { chooseMembership } from "../lib/access/choose-membership.ts";

const row = (business_id, role, created_at) => ({ business_id, role, status: "active", created_at });

test("chooseMembership: no membership is null", () => {
  assert.equal(chooseMembership([]), null);
  assert.equal(chooseMembership(null), null);
});

test("chooseMembership: the only membership is chosen", () => {
  assert.equal(chooseMembership([row("b1", "cashier", "2026-10-01T00:00:00Z")]).business_id, "b1");
});

test("chooseMembership: the highest role wins, whatever the order the rows come back in", () => {
  const ownerOfTrial = row("trial", "owner", "2026-10-02T00:00:00Z");
  const cashierInShop = row("shop", "cashier", "2026-10-01T00:00:00Z");
  assert.equal(chooseMembership([cashierInShop, ownerOfTrial]).business_id, "trial");
  assert.equal(chooseMembership([ownerOfTrial, cashierInShop]).business_id, "trial");
  assert.equal(chooseMembership([cashierInShop, row("m", "manager", "2026-10-03T00:00:00Z")]).business_id, "m");
});

test("chooseMembership: with equal roles the oldest membership wins, then the business id", () => {
  const older = row("b-new-id", "cashier", "2026-09-01T00:00:00Z");
  const newer = row("a-old-id", "cashier", "2026-10-01T00:00:00Z");
  assert.equal(chooseMembership([newer, older]).business_id, "b-new-id");
  assert.equal(chooseMembership([older, newer]).business_id, "b-new-id");
  const same = "2026-10-01T00:00:00Z";
  assert.equal(chooseMembership([row("b2", "owner", same), row("b1", "owner", same)]).business_id, "b1");
  assert.equal(chooseMembership([row("b1", "owner", same), row("b2", "owner", same)]).business_id, "b1");
});

test("chooseMembership: inactive rows are never chosen", () => {
  const inactiveOwner = { ...row("gone", "owner", "2026-01-01T00:00:00Z"), status: "inactive" };
  assert.equal(chooseMembership([inactiveOwner, row("shop", "cashier", "2026-10-01T00:00:00Z")]).business_id, "shop");
  assert.equal(chooseMembership([inactiveOwner]), null);
});
