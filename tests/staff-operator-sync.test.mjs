import assert from "node:assert/strict";
import test from "node:test";
import { carriesOperator } from "../lib/staff/operator-sync.ts";

test("carriesOperator: true only when the record in the payload names a person", () => {
  assert.equal(carriesOperator({ entity: "sale", payload: { sale: { id: "s", operatorMemberId: "m" } } }), true);
  assert.equal(carriesOperator({ entity: "sale", payload: { sale: { id: "s" } } }), false);
  assert.equal(carriesOperator({ entity: "credit-note", payload: { creditNote: { id: "c", approvedByMemberId: "m" } } }), true);
  assert.equal(carriesOperator({ entity: "stock", payload: { movement: { id: "x", operatorMemberId: "m" } } }), true);
  assert.equal(carriesOperator({ entity: "register", payload: { action: "open", register: { id: "r", openedOperatorMemberId: "m" } } }), true);
  assert.equal(carriesOperator({ entity: "register", payload: { action: "close", register: { id: "r", closedApprovedByMemberId: "m" } } }), true);
  assert.equal(carriesOperator({ entity: "register", payload: { action: "adjustment", adjustment: { id: "a", operatorMemberId: "m" } } }), true);
  assert.equal(carriesOperator({ entity: "customer", payload: { customer: { operatorMemberId: "m" } } }), false);
  assert.equal(carriesOperator({ entity: "sale" }), false);
  assert.equal(carriesOperator({ entity: "sale", payload: { sale: { id: "s", operatorMemberId: "" } } }), false);
});
