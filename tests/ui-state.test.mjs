import assert from "node:assert/strict";
import test from "node:test";
import { syncStatus } from "../lib/sync/status-text.ts";
import { answerConfirm, getConfirms, requestConfirm } from "../lib/ui/confirm-store.ts";
import { createToastStore, pushToast } from "../lib/ui/toast-store.ts";

const base = { mode: "hosted", online: true, pending: 0, needAttention: 0, syncing: false };

test("syncStatus speaks plainly, attention first", () => {
  assert.equal(syncStatus(base).text, "Online · all synced");
  assert.equal(syncStatus({ ...base, pending: 120, syncing: true }).text, "Syncing · 120 left");
  assert.equal(syncStatus({ ...base, online: false, pending: 8 }).text, "Offline · 8 waiting");
  assert.equal(syncStatus({ ...base, online: false }).text, "Offline · all saved");
  assert.deepEqual(syncStatus({ ...base, online: false, pending: 5, needAttention: 2 }), { text: "2 need attention", tone: "attention", attention: true });
  assert.equal(syncStatus({ ...base, mode: "sample", needAttention: 3 }).text, "Sample shop · not synced");
  assert.equal(syncStatus({ ...base, pending: 3 }).text, "Syncing · 3 left");
});

test("pushToast keeps the newest three", () => {
  let queue = [];
  for (const id of ["a", "b", "c", "d"]) queue = pushToast(queue, { id, message: id });
  assert.deepEqual(queue.map((t) => t.id), ["b", "c", "d"]);
});

test("toasts dismiss themselves after 4 seconds", () => {
  const timers = [];
  const store = createToastStore((callback, ms) => timers.push({ callback, ms }));
  store.toast("Product saved");
  assert.equal(store.getToasts().length, 1);
  assert.equal(timers[0].ms, 4000);
  timers[0].callback();
  assert.equal(store.getToasts().length, 0);
});

test("requestConfirm resolves with the answer and leaves the queue", async () => {
  const yes = requestConfirm({ title: "Archive?", body: "Hidden from the till.", confirmLabel: "Archive" });
  const no = requestConfirm({ title: "Discard?", body: "Not charged.", confirmLabel: "Discard", destructive: true });
  const [first, second] = getConfirms();
  answerConfirm(first.id, true);
  answerConfirm(second.id, false);
  assert.equal(await yes, true);
  assert.equal(await no, false);
  assert.equal(getConfirms().length, 0);
});

test("auto-sync waits until the shop has loaded (final review I1)", async () => {
  const { shouldAutoSync } = await import("../lib/sync/auto-sync.ts");
  assert.equal(shouldAutoSync({ ready: false, online: true, pending: 3 }), false);
  assert.equal(shouldAutoSync({ ready: true, online: true, pending: 3 }), true);
  assert.equal(shouldAutoSync({ ready: true, online: false, pending: 3 }), false);
  assert.equal(shouldAutoSync({ ready: true, online: true, pending: 0 }), false);
});
