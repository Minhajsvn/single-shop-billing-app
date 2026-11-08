import assert from "node:assert/strict";
import test from "node:test";
import { parseInvite, parseLockSettings, parseMemberUpdate, parsePinSet, staffErrorMessage } from "../lib/staff/actions.ts";
import { inviteStaff } from "../lib/staff/invite.ts";

const HASH = "JpGjAh9aPug1yuS6zmq1z8aMM0a3EHBhmBDCxrUiWqk=";
const SALT = "BwcHBwcHBwcHBwcHBwcHBw==";

test("parseInvite: email, display name and cashier or manager", () => {
  assert.deepEqual(parseInvite({ email: " Aisha@Shop.ae ", displayName: " Aisha ", role: "cashier" }), { ok: true, email: "aisha@shop.ae", displayName: "Aisha", role: "cashier" });
  assert.equal(parseInvite({ email: "no-at-sign", displayName: "A", role: "cashier" }).ok, false);
  assert.equal(parseInvite({ email: "a@b.ae", displayName: "A", role: "owner" }).ok, false);
  assert.equal(parseInvite({ email: "a@b.ae", displayName: "", role: "manager" }).ok, false, "a name is required");
  assert.equal(parseInvite({ email: "a@b.ae", displayName: "x".repeat(61), role: "manager" }).ok, false);
});

test("parseMemberUpdate: exactly one of role or status", () => {
  assert.deepEqual(parseMemberUpdate({ role: "manager" }), { ok: true, change: { role: "manager" } });
  assert.deepEqual(parseMemberUpdate({ status: "disabled" }), { ok: true, change: { status: "disabled" } });
  assert.equal(parseMemberUpdate({ role: "manager", status: "active" }).ok, false);
  assert.equal(parseMemberUpdate({ role: "owner" }).ok, false);
  assert.equal(parseMemberUpdate({}).ok, false);
});

test("parsePinSet: base64 of 32 and 16 bytes", () => {
  assert.deepEqual(parsePinSet({ pinHash: HASH, pinSalt: SALT }), { ok: true, pinHash: HASH, pinSalt: SALT });
  assert.equal(parsePinSet({ pinHash: "short", pinSalt: SALT }).ok, false);
  assert.equal(parsePinSet({ pinHash: HASH, pinSalt: "1234" }).ok, false);
  assert.equal(parsePinSet({ pin: "1234" }).ok, false, "a raw PIN is never accepted");
});

test("parseLockSettings: switch, 1-60 minutes, 0-100 percent", () => {
  assert.deepEqual(parseLockSettings({ pinLockEnabled: true, idleLockMinutes: 5, managerDiscountPct: 10 }), { ok: true, pinLockEnabled: true, idleLockMinutes: 5, managerDiscountPct: 10 });
  for (const bad of [{ idleLockMinutes: 0 }, { idleLockMinutes: 61 }, { managerDiscountPct: 101 }, { managerDiscountPct: -1 }, { idleLockMinutes: 2.5 }, { pinLockEnabled: "yes" }]) {
    assert.equal(parseLockSettings({ pinLockEnabled: false, idleLockMinutes: 5, managerDiscountPct: 10, ...bad }).ok, false, JSON.stringify(bad));
  }
});

test("staffErrorMessage: a plain sentence for every refusal code, and a fallback", () => {
  for (const code of ["pin_not_set", "member_disabled", "owner_protected", "plan_limit_reached", "feature_not_in_plan", "not_owner"]) {
    assert.ok(staffErrorMessage(code).length > 10, code);
    assert.notEqual(staffErrorMessage(code), staffErrorMessage("something_else"), code);
  }
});

function fakes({ lookup = { data: { userId: null } }, invite = { userId: "u-new" }, add = { data: "m-new" } } = {}) {
  const calls = [];
  const admin = { rpc: async (name, args) => { calls.push(["admin", name, args]); return lookup; } };
  const user = { rpc: async (name, args) => { calls.push(["user", name, args]); return add; } };
  return { calls, admin, user, invite: async (email) => { calls.push(["invite", email]); return invite; } };
}

test("inviteStaff: unknown email is invited, then added through the owner's session", async () => {
  const f = fakes();
  const result = await inviteStaff(f.user, f.admin, { businessId: "b", email: "a@b.ae", displayName: "Aisha", role: "cashier" }, { invite: f.invite });
  assert.deepEqual(result, { ok: true, memberId: "m-new", invited: true });
  assert.deepEqual(f.calls.map((c) => (c[0] === "invite" ? "invite" : c[1])), ["admin_member_lookup", "invite", "staff_add_member"]);
  assert.deepEqual(f.calls[2][2], { p_business_id: "b", p_user_id: "u-new", p_role: "cashier", p_display_name: "Aisha" });
});

test("inviteStaff: an existing account is linked without an invite", async () => {
  const f = fakes({ lookup: { data: { userId: "u-old" } } });
  const result = await inviteStaff(f.user, f.admin, { businessId: "b", email: "a@b.ae", displayName: "A", role: "manager" }, { invite: f.invite });
  assert.deepEqual(result, { ok: true, memberId: "m-new", invited: false });
  assert.equal(f.calls.some((c) => c[0] === "invite"), false);
});

test("inviteStaff: refusals stop early and keep their code", async () => {
  const full = fakes({ lookup: { error: { code: "P0001", message: "plan_limit_reached" } } });
  assert.deepEqual(await inviteStaff(full.user, full.admin, { businessId: "b", email: "a@b.ae", displayName: "A", role: "cashier" }, { invite: full.invite }), { ok: false, code: "plan_limit_reached" });
  assert.equal(full.calls.length, 1);
  const bad = fakes({ invite: { error: "smtp down" } });
  assert.deepEqual(await inviteStaff(bad.user, bad.admin, { businessId: "b", email: "a@b.ae", displayName: "A", role: "cashier" }, { invite: bad.invite }), { ok: false, code: "invite_failed" });
  assert.equal(bad.calls.some((c) => c[1] === "staff_add_member"), false);
  const notOwner = fakes({ add: { error: { code: "P0001", message: "not_owner" } } });
  assert.deepEqual(await inviteStaff(notOwner.user, notOwner.admin, { businessId: "b", email: "a@b.ae", displayName: "A", role: "cashier" }, { invite: notOwner.invite }), { ok: false, code: "not_owner" });
});
