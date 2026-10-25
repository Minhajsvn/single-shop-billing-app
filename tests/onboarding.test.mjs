import assert from "node:assert/strict";
import test from "node:test";
import { checklistView } from "../lib/onboarding/checklist.ts";

const flags = (hasProduct, hasOpenedRegister, hasSale) => ({ hasProduct, hasOpenedRegister, hasSale });
const owner = { role: "owner", mode: "hosted" };

test("a fresh shop is at 0 of 3 and asked to add products", () => {
  assert.deepEqual(checklistView(flags(false, false, false), owner), {
    done: 0, next: { label: "Add your products", button: "Add products", href: "/inventory" },
  });
});

test("with products the next step is opening the register", () => {
  assert.deepEqual(checklistView(flags(true, false, false), owner), {
    done: 1, next: { label: "Open the register", button: "Open register", href: "/register" },
  });
});

test("with products and a register the next step is the first sale", () => {
  assert.deepEqual(checklistView(flags(true, true, false), owner), {
    done: 2, next: { label: "Make your first sale", button: "New sale", href: "/sale" },
  });
});

test("all three done leaves no next step", () => {
  assert.deepEqual(checklistView(flags(true, true, true), owner), { done: 3, next: null });
});

test("the first unfinished step is next even when a later one is done", () => {
  assert.equal(checklistView(flags(false, true, true), owner).done, 2);
  assert.equal(checklistView(flags(false, true, true), owner).next.label, "Add your products");
});

test("only hosted owners see the checklist", () => {
  const f = flags(false, false, false);
  assert.equal(checklistView(f, { role: "cashier", mode: "hosted" }), null);
  assert.equal(checklistView(f, { role: "manager", mode: "hosted" }), null);
  assert.equal(checklistView(f, { role: "owner", mode: "sample" }), null);
  assert.equal(checklistView(f, { role: "owner", mode: "unconfigured" }), null);
  assert.equal(checklistView(null, owner), null);
});
