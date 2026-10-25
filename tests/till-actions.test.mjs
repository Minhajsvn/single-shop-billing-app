import assert from "node:assert/strict";
import test from "node:test";
import { pauseTillPrompt, resumeLimitMessage, tillRowAction } from "../lib/access/tills.ts";

const till = (id, status, tillNumber = 1) => ({ id, status, tillNumber });

test("tillRowAction: owners pause active tills and resume paused ones", () => {
  const devices = [till("a", "active", 1), till("b", "active", 2), till("c", "paused", 3), till("d", "revoked", 4)];
  assert.equal(tillRowAction("owner", devices[0], devices), "pause");
  assert.equal(tillRowAction("owner", devices[1], devices), "pause");
  assert.equal(tillRowAction("owner", devices[2], devices), "resume");
  assert.equal(tillRowAction("owner", devices[3], devices), null);
});

test("tillRowAction: the last active till has no Pause", () => {
  const devices = [till("a", "active", 1), till("c", "paused", 2), till("d", "revoked", 3)];
  assert.equal(tillRowAction("owner", devices[0], devices), null);
  assert.equal(tillRowAction("owner", devices[1], devices), "resume");
});

test("tillRowAction: managers and cashiers see the list read-only", () => {
  const devices = [till("a", "active", 1), till("b", "active", 2), till("c", "paused", 3)];
  for (const role of ["manager", "cashier", null]) {
    for (const item of devices) assert.equal(tillRowAction(role, item, devices), null);
  }
});

test("resumeLimitMessage and pauseTillPrompt copy", () => {
  assert.equal(resumeLimitMessage(1), "Your plan allows 1 till. Pause another till first or upgrade.");
  assert.equal(resumeLimitMessage(2), "Your plan allows 2 tills. Pause another till first or upgrade.");
  assert.deepEqual(pauseTillPrompt(3), { title: "Pause Till 3?", body: "It stops selling until you resume it. A shift already open on it can still finish." });
});
