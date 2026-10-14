import assert from "node:assert/strict";
import test from "node:test";
import { READ_ONLY_ENTITLEMENTS } from "../lib/billing/entitlements.ts";
import { createSerialQueue, createSyncEpoch, effectiveEntitlements, emptyShopState, parseHostedCache } from "../lib/store/hosted.ts";

const full = {
  planId: "pro", status: "trialing", access: "full", trialEndsAt: null, graceEndsAt: null,
  features: ["serial_tracking"], limits: { branches: 1, tills: 2, members: 5, products: null },
};
const now = new Date("2026-10-14T10:00:00Z");

test("cached entitlements are used until they expire, then read-only", () => {
  assert.equal(effectiveEntitlements({ entitlements: full, expiresAt: "2026-10-14T11:00:00Z" }, now).access, "full");
  assert.equal(effectiveEntitlements({ entitlements: full, expiresAt: "2026-10-14T10:00:00Z" }, now), READ_ONLY_ENTITLEMENTS);
  assert.equal(effectiveEntitlements({ entitlements: full, expiresAt: "not a date" }, now), READ_ONLY_ENTITLEMENTS);
  assert.equal(effectiveEntitlements(null, now), READ_ONLY_ENTITLEMENTS);
});

test("hosted cache parsing never throws and rejects foreign shapes", () => {
  assert.equal(parseHostedCache(null), null);
  assert.equal(parseHostedCache("{not json"), null);
  assert.equal(parseHostedCache(JSON.stringify({ products: [] })), null, "a legacy demo-store blob is not a hosted cache");
  const cache = { version: 1, state: emptyShopState(), context: { business: null, devices: [], entitlementCache: null, lastRefreshedAt: null } };
  assert.deepEqual(parseHostedCache(JSON.stringify(cache)), cache);
});

test("empty shop state has no demo data", () => {
  const state = emptyShopState();
  assert.deepEqual([state.products, state.sales, state.customers, state.creditNotes, state.stockMovements, state.syncOperations], [[], [], [], [], [], []]);
  assert.equal(state.register, null);
});

test("serial queue runs tasks one at a time, in order, and survives a failure", async () => {
  const run = createSerialQueue();
  const events = [];
  const slow = (name, ms) => async () => { events.push(`start ${name}`); await new Promise((r) => setTimeout(r, ms)); events.push(`end ${name}`); return name; };
  const failing = run(async () => { events.push("start bad"); throw new Error("boom"); });
  const a = run(slow("a", 20));
  const b = run(slow("b", 1));
  await assert.rejects(failing, /boom/);
  assert.deepEqual(await Promise.all([a, b]), ["a", "b"]);
  assert.deepEqual(events, ["start bad", "start a", "end a", "start b", "end b"]);
});

test("sync epoch marks refreshes started before a sync completed as stale", () => {
  const epoch = createSyncEpoch();
  const started = epoch.current();
  assert.equal(epoch.isStale(started), false);
  epoch.bump();
  assert.equal(epoch.isStale(started), true);
  assert.equal(epoch.isStale(epoch.current()), false);
});
