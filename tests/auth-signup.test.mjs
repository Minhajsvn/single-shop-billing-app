import assert from "node:assert/strict";
import test from "node:test";
import { confirmParams, isEmailNotConfirmed, NETWORK_ERROR, PASSWORD_RULE, RATE_LIMITED, signupErrorMessage, validateSignup } from "../lib/auth/signup.ts";

const ok = { name: "Aisha Khan", email: "aisha@example.com", password: "longenough" };

test("a complete signup passes validation", () => {
  assert.equal(validateSignup(ok), null);
});

test("signup needs a name", () => {
  assert.equal(validateSignup({ ...ok, name: "   " }), "Enter your name.");
});

test("signup needs a real email address", () => {
  assert.equal(validateSignup({ ...ok, email: "aisha" }), "Enter a valid email address.");
  assert.equal(validateSignup({ ...ok, email: "aisha@shop" }), "Enter a valid email address.");
});

test("a 7-character password gets the password rule", () => {
  assert.equal(validateSignup({ ...ok, password: "1234567" }), "Use at least 8 characters.");
  assert.equal(PASSWORD_RULE, "Use at least 8 characters.");
  assert.equal(validateSignup({ ...ok, password: "12345678" }), null);
});

test("no error means no message", () => {
  assert.equal(signupErrorMessage(null), null);
});

test("a fetch failure shows the network copy", () => {
  assert.equal(signupErrorMessage({ message: "Failed to fetch", status: 0 }), "Could not reach the server. Try again.");
  assert.equal(signupErrorMessage({ message: "TypeError: fetch failed" }), NETWORK_ERROR);
  assert.equal(signupErrorMessage({ message: "Bad gateway", status: 502 }), NETWORK_ERROR);
});

test("an already-registered email does not reveal the account", () => {
  assert.equal(signupErrorMessage({ message: "User already registered", status: 422 }), null);
  assert.equal(signupErrorMessage({ message: "A user with this email address has already been registered", status: 422 }), null);
});

test("a rate limit says to wait", () => {
  assert.equal(signupErrorMessage({ message: "email rate limit exceeded", status: 429 }), RATE_LIMITED);
});

test("a weak password from the server shows the rule", () => {
  assert.equal(signupErrorMessage({ message: "Password should be at least 8 characters.", status: 422 }), PASSWORD_RULE);
});

test("valid signup link defaults to setup", () => {
  assert.deepEqual(confirmParams(new URL("http://localhost:3101/auth/confirm?token_hash=abc&type=signup")), { tokenHash: "abc", type: "signup", next: "/setup" });
});

test("valid recovery link keeps a local next", () => {
  assert.deepEqual(
    confirmParams(new URL("http://localhost:3101/auth/confirm?token_hash=abc&type=recovery&next=/reset-password")),
    { tokenHash: "abc", type: "recovery", next: "/reset-password" },
  );
  assert.deepEqual(confirmParams(new URL("http://localhost:3101/auth/confirm?token_hash=abc&type=recovery")), { tokenHash: "abc", type: "recovery", next: "/reset-password" });
});

test("a link without a token or with an unknown type is rejected", () => {
  assert.equal(confirmParams(new URL("http://localhost:3101/auth/confirm?type=signup")), null);
  assert.equal(confirmParams(new URL("http://localhost:3101/auth/confirm?token_hash=&type=signup")), null);
  assert.equal(confirmParams(new URL("http://localhost:3101/auth/confirm?token_hash=abc")), null);
  assert.equal(confirmParams(new URL("http://localhost:3101/auth/confirm?token_hash=abc&type=magiclink")), null);
});

test("next cannot leave the app", () => {
  assert.equal(confirmParams(new URL("http://localhost:3101/auth/confirm?token_hash=abc&type=signup&next=//evil.com"))?.next, "/setup");
  assert.equal(confirmParams(new URL("http://localhost:3101/auth/confirm?token_hash=abc&type=signup&next=https://x"))?.next, "/setup");
  assert.equal(confirmParams(new URL("http://localhost:3101/auth/confirm?token_hash=abc&type=recovery&next=/\\evil.com"))?.next, "/reset-password");
});

test("control characters or backslashes in next cannot make an off-site redirect", () => {
  for (const next of ["/%09/evil.com", "/%0A/evil.com", "/%0D/evil.com", "%2F%09%2Fevil.com", "/%5Cevil.com", "/x%00y", "/%20/evil.com"]) {
    const url = new URL(`http://localhost:3101/auth/confirm?token_hash=abc&type=signup&next=${next}`);
    assert.equal(confirmParams(url)?.next, "/setup", next);
  }
});

test("a normal local next keeps its query and hash", () => {
  assert.equal(confirmParams(new URL("http://localhost:3101/auth/confirm?token_hash=abc&type=signup&next=%2Foverview%3Fa%3D1%23b"))?.next, "/overview?a=1#b");
});

test("an unconfirmed sign-in is recognised", () => {
  assert.equal(isEmailNotConfirmed({ message: "Email not confirmed", status: 400, code: "email_not_confirmed" }), true);
  assert.equal(isEmailNotConfirmed({ message: "Invalid login credentials", status: 400 }), false);
  assert.equal(isEmailNotConfirmed(null), false);
});

test("email-change links default to the overview", () => {
  assert.deepEqual(confirmParams(new URL("http://localhost:3101/auth/confirm?token_hash=abc&type=email")), { tokenHash: "abc", type: "email", next: "/overview" });
});
