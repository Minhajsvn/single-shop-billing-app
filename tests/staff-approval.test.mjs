import assert from "node:assert/strict";
import test from "node:test";
import { approverChoices, needsApproval } from "../lib/staff/approval.ts";
import { canEditCatalogue } from "../lib/access/cashier.ts";

const SIMPLE = ["refund", "remove-line", "lower-quantity", "register-open", "register-close"];

test("needsApproval: a cashier needs a manager for every listed action; managers and owners never do", () => {
  for (const kind of SIMPLE) {
    assert.equal(needsApproval({ kind }, "cashier", 10), true, kind);
    assert.equal(needsApproval({ kind }, "manager", 10), false, kind);
    assert.equal(needsApproval({ kind }, "owner", 10), false, kind);
  }
});

test("needsApproval: a discount needs a manager only above the set percentage", () => {
  const discount = (discountFils, listTotalFils) => ({ kind: "discount", discountFils, listTotalFils });
  assert.equal(needsApproval(discount(1000, 10000), "cashier", 10), false, "exactly 10% is fine");
  assert.equal(needsApproval(discount(1001, 10000), "cashier", 10), true, "10.01% needs approval");
  assert.equal(needsApproval(discount(0, 10000), "cashier", 0), false, "no discount never needs approval");
  assert.equal(needsApproval(discount(1, 10000), "cashier", 0), true, "0% setting: any discount needs approval");
  assert.equal(needsApproval(discount(10000, 10000), "cashier", 100), false, "100% setting allows a free sale");
  assert.equal(needsApproval(discount(5000, 10000), "manager", 0), false, "managers are not asked");
});

test("approverChoices: active managers and the owner with a PIN, never the operator", () => {
  const staff = [
    { memberId: "o", displayName: "Owner", role: "owner", status: "active", pinHash: "h", pinSalt: "s" },
    { memberId: "m1", displayName: "Manager", role: "manager", status: "active", pinHash: "h", pinSalt: "s" },
    { memberId: "m2", displayName: "No PIN", role: "manager", status: "active", pinHash: null, pinSalt: null },
    { memberId: "m3", displayName: "Disabled", role: "manager", status: "disabled", pinHash: "h", pinSalt: "s" },
    { memberId: "c1", displayName: "Cashier", role: "cashier", status: "active", pinHash: "h", pinSalt: "s" },
  ];
  assert.deepEqual(approverChoices(staff, "c1").map((m) => m.memberId), ["o", "m1"]);
  assert.deepEqual(approverChoices(staff, "m1").map((m) => m.memberId), ["o"]);
});

test("canEditCatalogue: managers and owners edit products and stock; cashiers do not", () => {
  assert.equal(canEditCatalogue("manager"), true);
  assert.equal(canEditCatalogue("owner"), true);
  assert.equal(canEditCatalogue(null), true);
  assert.equal(canEditCatalogue("cashier"), false);
});
