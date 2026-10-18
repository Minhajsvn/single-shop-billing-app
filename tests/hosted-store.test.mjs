import assert from "node:assert/strict";
import test from "node:test";
import { READ_ONLY_ENTITLEMENTS } from "../lib/billing/entitlements.ts";
import { applySyncResults, chunk, createSerialQueue, createSyncEpoch, effectiveEntitlements, emptyShopState, hostedCacheKey, parseHostedCache, pickNewerCache, restoreFromIndexed } from "../lib/store/hosted.ts";

test("sync batches respect the server's 50-operation limit", () => {
  const ops = Array.from({ length: 120 }, (_, index) => index);
  assert.deepEqual(chunk(ops, 50).map((batch) => batch.length), [50, 50, 20]);
  assert.deepEqual(chunk([], 50), []);
  assert.deepEqual(chunk([1, 2], 50), [[1, 2]]);
});

test("the hosted cache is scoped to the signed-in user", () => {
  assert.equal(hostedCacheKey("user-a"), "shop-ledger-hosted-store-v1:user-a");
  assert.notEqual(hostedCacheKey("user-a"), hostedCacheKey("user-b"));
});

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
  const cache = { version: 1, savedAt: 5, state: emptyShopState(), context: { business: null, devices: [], entitlementCache: null, lastRefreshedAt: null } };
  assert.deepEqual(parseHostedCache(JSON.stringify(cache)), cache);
});

test("a hosted cache written before Stage 1D reads as savedAt 0", () => {
  const legacy = { version: 1, state: emptyShopState(), context: { business: null, devices: [], entitlementCache: null, lastRefreshedAt: null } };
  assert.equal(parseHostedCache(JSON.stringify(legacy))?.savedAt, 0);
});

test("applySyncResults marks one batch's accepted and rejected operations and leaves the rest pending", () => {
  const op = (id, status = "pending") => ({ id, entity: "product", entityId: id, createdAt: "2026-10-18T10:00:00.000Z", status });
  const next = applySyncResults(
    [op("a"), op("b", "failed"), op("c"), op("d", "synced")],
    [{ id: "a", status: "accepted" }, { id: "b", status: "rejected", error: "product_sku_taken" }],
  );
  assert.deepEqual(next.map((o) => [o.id, o.status, o.error]), [["a", "synced", undefined], ["b", "failed", "product_sku_taken"], ["c", "pending", undefined], ["d", "synced", undefined]]);
  assert.equal(applySyncResults([op("e")], [{ id: "e", status: "rejected" }])[0].error, "The hosted service rejected this operation.");
});

test("restoreFromIndexed takes the newer IndexedDB state and keeps every outbox operation from both copies", () => {
  const op = (id) => ({ id, entity: "product", entityId: id, createdAt: "2026-10-18T10:00:00.000Z", status: "pending" });
  const customer = { id: "c1", name: "Omar", phone: "+971", createdAt: "x", updatedAt: "x" };
  // Customers decrypted (or a sale was made) before the large IndexedDB read finished.
  const current = { ...emptyShopState(), customers: [customer], syncOperations: [op("made-after-load"), op("shared")] };
  const indexed = { ...emptyShopState(), products: [{ id: "p", name: "P", sku: "P", priceFils: 1, stock: 1, lowStockThreshold: 0, active: true }], syncOperations: [op("import-1"), op("import-2"), op("shared")] };
  delete indexed.customers;
  const restored = restoreFromIndexed(current, indexed);
  assert.deepEqual(restored.syncOperations.map((o) => o.id).sort(), ["import-1", "import-2", "made-after-load", "shared"]);
  assert.equal(restored.products[0].taxCategory, "standard");
  assert.deepEqual(restored.customers, [customer]);
});

test("pickNewerCache prefers the newer copy and falls back to whichever exists", () => {
  assert.equal(pickNewerCache(null, { savedAt: 1 }), "indexed");
  assert.equal(pickNewerCache({ savedAt: 5 }, { savedAt: 3 }), "local");
  assert.equal(pickNewerCache({ savedAt: 3 }, { savedAt: 5 }), "indexed");
  assert.equal(pickNewerCache({ savedAt: 3 }, { savedAt: 3 }), "local");
  assert.equal(pickNewerCache({ savedAt: 3 }, null), "local");
  assert.equal(pickNewerCache(null, null), null);
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
