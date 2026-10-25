import assert from "node:assert/strict";
import test from "node:test";
import { cronSecretMatches, isStaff, parseStaffEmails } from "../lib/admin/staff.ts";
import { routeDecision } from "../lib/auth/access-rules.ts";

const SECRET = "s".repeat(32);
const confirmed = (email) => ({ email, email_confirmed_at: "2026-10-01T00:00:00Z" });

test("staff emails are trimmed, lower-cased and blanks dropped", () => {
  assert.deepEqual(parseStaffEmails(" A@x.com , b@y.com,,"), new Set(["a@x.com", "b@y.com"]));
});

test("a missing or empty allowlist names nobody", () => {
  assert.equal(parseStaffEmails(undefined).size, 0);
  assert.equal(parseStaffEmails("").size, 0);
  assert.equal(parseStaffEmails(" , ,").size, 0);
});

test("a listed, confirmed user is staff in any letter case", () => {
  const env = { PLATFORM_STAFF_EMAILS: "Owner@Platform.com" };
  assert.equal(isStaff(confirmed("owner@platform.com"), env), true);
  assert.equal(isStaff(confirmed("OWNER@PLATFORM.COM"), env), true);
});

test("an unconfirmed email is not staff even when listed", () => {
  const env = { PLATFORM_STAFF_EMAILS: "owner@platform.com" };
  assert.equal(isStaff({ email: "owner@platform.com", email_confirmed_at: null }, env), false);
  assert.equal(isStaff({ email: "owner@platform.com" }, env), false);
});

test("an unlisted user, a user without email and a signed-out visitor are not staff", () => {
  const env = { PLATFORM_STAFF_EMAILS: "owner@platform.com" };
  assert.equal(isStaff(confirmed("shop@owner.com"), env), false);
  assert.equal(isStaff({ email: null, email_confirmed_at: "2026-10-01T00:00:00Z" }, env), false);
  assert.equal(isStaff(null, env), false);
});

test("nobody is staff when the allowlist env is missing", () => {
  assert.equal(isStaff(confirmed("owner@platform.com"), {}), false);
  assert.equal(isStaff(confirmed("owner@platform.com"), { PLATFORM_STAFF_EMAILS: "" }), false);
});

test("the cron secret matches only the exact secret", () => {
  const env = { ADMIN_CRON_SECRET: SECRET };
  assert.equal(cronSecretMatches(SECRET, env), true);
  assert.equal(cronSecretMatches(`${SECRET}x`, env), false);
  assert.equal(cronSecretMatches("s".repeat(31), env), false);
  assert.equal(cronSecretMatches("t".repeat(32), env), false);
  assert.equal(cronSecretMatches("", env), false);
  assert.equal(cronSecretMatches(null, env), false);
});

test("the cron secret never matches when the env secret is missing or short", () => {
  assert.equal(cronSecretMatches(SECRET, {}), false);
  assert.equal(cronSecretMatches("", { ADMIN_CRON_SECRET: "" }), false);
  const short = "s".repeat(31);
  assert.equal(cronSecretMatches(short, { ADMIN_CRON_SECRET: short }), false);
});

test("the proxy lets /admin paths through for signed-out visitors so they can 404", () => {
  for (const pathname of ["/admin", "/admin/shops/x"]) {
    assert.equal(routeDecision({ signedIn: false, pathname, sampleCookie: undefined }), "allow");
  }
});

test("paths that only start with the letters admin still go to login", () => {
  assert.equal(routeDecision({ signedIn: false, pathname: "/administrator", sampleCookie: undefined }), "login");
});
