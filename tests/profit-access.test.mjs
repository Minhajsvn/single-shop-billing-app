import assert from "node:assert/strict";
import test from "node:test";
import { costAccess } from "../lib/profit/access.ts";

const pro = { mode: "hosted", hasCostFeature: true };

test("owner at the owner's till sees and edits costs", () => {
  assert.deepEqual(costAccess({ ...pro, sessionRole: "owner", effectiveRole: "owner" }), { canSee: true, canEdit: true });
});

test("a manager behind the PIN on the owner's till sees costs but cannot change or import them", () => {
  assert.deepEqual(costAccess({ ...pro, sessionRole: "owner", effectiveRole: "manager" }), { canSee: true, canEdit: false });
});

test("a manager signed in on their own device sees costs read-only", () => {
  assert.deepEqual(costAccess({ ...pro, sessionRole: "manager", effectiveRole: "manager" }), { canSee: true, canEdit: false });
});

test("cashiers, Starter shops and sample shops never see costs", () => {
  assert.deepEqual(costAccess({ ...pro, sessionRole: "owner", effectiveRole: "cashier" }), { canSee: false, canEdit: false });
  assert.deepEqual(costAccess({ mode: "hosted", hasCostFeature: false, sessionRole: "owner", effectiveRole: "owner" }), { canSee: false, canEdit: false });
  assert.deepEqual(costAccess({ mode: "sample", hasCostFeature: true, sessionRole: null, effectiveRole: null }), { canSee: false, canEdit: false });
});
