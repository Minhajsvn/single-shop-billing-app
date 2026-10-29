import assert from "node:assert/strict";
import test from "node:test";
import { addMember, memberInShop, sendPasswordReset } from "../lib/admin/members.ts";

const SHOP = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const MEMBER = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";
const input = { businessId: SHOP, email: "new@example.com", role: "cashier", actor: ACTOR, note: "Asked by phone" };

/** A fake admin client that records rpc names and answers from `answers`. */
function fakeAdmin({ answers = {}, member = { business_id: SHOP, user_id: USER }, email = "cashier@example.com", resetError = null } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args });
      const answer = answers[name];
      if (answer?.error) return { data: null, error: answer.error };
      return { data: answer?.data ?? null, error: null };
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: member, error: null }) }) }) }),
    auth: {
      admin: { getUserById: async () => ({ data: { user: email ? { email } : null }, error: null }) },
      resetPasswordForEmail: async (address, options) => {
        calls.push({ name: "resetPasswordForEmail", args: { address, options } });
        return { error: resetError };
      },
    },
  };
}

test("an unknown email is invited, then added with the new user id", async () => {
  const admin = fakeAdmin({ answers: { admin_member_lookup: { data: { userId: null } }, admin_add_member: { data: MEMBER } } });
  const invited = [];
  const result = await addMember(admin, input, { invite: async (email) => (invited.push(email), { userId: USER }) });
  assert.deepEqual(result, { ok: true, memberId: MEMBER, invited: true });
  assert.deepEqual(invited, ["new@example.com"]);
  assert.deepEqual(admin.calls.map((c) => c.name), ["admin_member_lookup", "admin_add_member"]);
  assert.equal(admin.calls[1].args.p_user_id, USER);
  assert.equal(admin.calls[1].args.p_role, "cashier");
});

test("an invite error returns invite_failed and never inserts", async () => {
  const admin = fakeAdmin({ answers: { admin_member_lookup: { data: { userId: null } } } });
  const result = await addMember(admin, input, { invite: async () => ({ error: "smtp down" }) });
  assert.deepEqual(result, { ok: false, code: "invite_failed" });
  assert.equal(admin.calls.some((c) => c.name === "admin_add_member"), false);
});

test("an existing account is added without an invite", async () => {
  const admin = fakeAdmin({ answers: { admin_member_lookup: { data: { userId: USER } }, admin_add_member: { data: MEMBER } } });
  let invites = 0;
  const result = await addMember(admin, input, { invite: async () => (invites++, { userId: "x" }) });
  assert.deepEqual(result, { ok: true, memberId: MEMBER, invited: false });
  assert.equal(invites, 0);
  assert.equal(admin.calls[1].args.p_user_id, USER);
});

test("a lookup refusal is returned by code and nothing else runs", async () => {
  const admin = fakeAdmin({ answers: { admin_member_lookup: { error: { code: "P0001", message: "already_member" } } } });
  const result = await addMember(admin, input, { invite: async () => ({ userId: "x" }) });
  assert.deepEqual(result, { ok: false, code: "already_member" });
  assert.deepEqual(admin.calls.map((c) => c.name), ["admin_member_lookup"]);
});

test("an add refusal after an invite is returned by code", async () => {
  const admin = fakeAdmin({ answers: { admin_member_lookup: { data: { userId: USER } }, admin_add_member: { error: { code: "P0001", message: "plan_limit_reached" } } } });
  assert.deepEqual(await addMember(admin, input), { ok: false, code: "plan_limit_reached" });
});

test("a reset sends the recovery email to the member's address, then writes the audit row", async () => {
  const admin = fakeAdmin();
  const result = await sendPasswordReset(admin, { memberId: MEMBER, actor: ACTOR, note: "Forgot it" });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(admin.calls.map((c) => c.name), ["resetPasswordForEmail", "admin_log_password_reset"]);
  assert.equal(admin.calls[0].args.address, "cashier@example.com");
});

test("a reset send error returns reset_failed and writes no audit row", async () => {
  const admin = fakeAdmin({ resetError: { message: "smtp down" } });
  assert.deepEqual(await sendPasswordReset(admin, { memberId: MEMBER, actor: ACTOR, note: "x" }), { ok: false, code: "reset_failed" });
  assert.equal(admin.calls.some((c) => c.name === "admin_log_password_reset"), false);
});

test("a reset for a missing member is member_not_found and sends nothing", async () => {
  const admin = fakeAdmin({ member: null });
  assert.deepEqual(await sendPasswordReset(admin, { memberId: MEMBER, actor: ACTOR, note: "x" }), { ok: false, code: "member_not_found" });
  assert.deepEqual(admin.calls, []);
});

test("memberInShop is true only for a member of that shop", async () => {
  assert.equal(await memberInShop(fakeAdmin(), MEMBER, SHOP), true);
  assert.equal(await memberInShop(fakeAdmin(), MEMBER, "55555555-5555-4555-8555-555555555555"), false);
  assert.equal(await memberInShop(fakeAdmin({ member: null }), MEMBER, SHOP), false);
});
