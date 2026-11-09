import assert from "node:assert/strict";
import test from "node:test";
import { actorFields, getOperator, reconcileOperator, restoreOperator, setOperator } from "../lib/staff/operator-session.ts";

function memoryStore() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
}

const aisha = { memberId: "m1", displayName: "Aisha", role: "cashier", status: "active", pinHash: "h1", pinSalt: "s1" };

test("a reload restores the operator only while they are active with the same PIN", () => {
  const store = memoryStore();
  setOperator(aisha, store);
  assert.equal(restoreOperator([aisha], store)?.memberId, "m1");
  assert.equal(restoreOperator([{ ...aisha, status: "disabled" }], store), null, "disabled");
  setOperator(aisha, store);
  assert.equal(restoreOperator([{ ...aisha, pinHash: "h2" }], store), null, "PIN reset or changed");
  assert.equal(restoreOperator([aisha], memoryStore()), null, "nothing stored: lock screen");
  assert.equal(getOperator(), null);
});

test("a new staff list drops a disabled operator and picks up a role change", () => {
  const store = memoryStore();
  setOperator(aisha, store);
  reconcileOperator([{ ...aisha, role: "manager" }], store);
  assert.equal(getOperator()?.role, "manager");
  reconcileOperator([{ ...aisha, role: "manager", status: "disabled" }], store);
  assert.equal(getOperator(), null);
  setOperator(aisha, store);
  reconcileOperator([], store);
  assert.equal(getOperator(), null, "removed from the list");
});

test("actorFields: operator and approver ids, nothing without an operator", () => {
  assert.deepEqual(actorFields(aisha), { operatorMemberId: "m1" });
  assert.deepEqual(actorFields(aisha, "m9"), { operatorMemberId: "m1", approvedByMemberId: "m9" });
  assert.deepEqual(actorFields(null, "m9"), {});
});
