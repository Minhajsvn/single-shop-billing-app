import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { cronSecretMatches, isStaff, parseStaffEmails } from "../lib/admin/staff.ts";
import { routeDecision } from "../lib/auth/access-rules.ts";
import { ADMIN_ROUTE_METHODS, adminNotFound } from "../lib/admin/not-found.ts";
import * as catchAll from "../app/api/v1/[[...path]]/route.ts";

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

test("signed-out visitors on /admin paths go to login exactly like any unknown path", () => {
  for (const pathname of ["/admin", "/admin/shops/x", "/no-such-page"]) {
    assert.equal(routeDecision({ signedIn: false, pathname, sampleCookie: undefined }), "login");
  }
});

test("signed-in visitors reach /admin paths so the page itself can 404 non-staff", () => {
  for (const pathname of ["/admin", "/admin/shops/x"]) {
    assert.equal(routeDecision({ signedIn: true, pathname, sampleCookie: undefined }), "allow");
  }
});

async function snapshot(response) {
  return { status: response.status, type: response.headers.get("content-type"), body: await response.text() };
}

test("the admin 404 is a plain JSON not-found", async () => {
  assert.deepEqual(await snapshot(adminNotFound()), { status: 404, type: "application/json", body: '{"error":"Not found"}' });
});

test("every method on an unknown /api/v1 path answers exactly the admin 404", async () => {
  const expected = await snapshot(adminNotFound());
  for (const method of ADMIN_ROUTE_METHODS) {
    assert.equal(typeof catchAll[method], "function", `catch-all exports ${method}`);
    const actual = await snapshot(await catchAll[method](new Request(`http://x/api/v1/nope`, { method })));
    assert.deepEqual(actual, expected, method);
  }
});

test("the admin method list covers every method Next would otherwise answer with 405 or an automatic OPTIONS", () => {
  assert.deepEqual([...ADMIN_ROUTE_METHODS].sort(), ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]);
});

test("paths that only start with the letters admin still go to login", () => {
  assert.equal(routeDecision({ signedIn: false, pathname: "/administrator", sampleCookie: undefined }), "login");
});

// Route files import through the "@/" alias, so the unit tests check their source: staff gate on every
// implemented handler and adminNotFound for every other method.
const ADMIN_ROUTES = {
  "app/api/v1/admin/shops/[id]/trial/route.ts": ["POST"],
  "app/api/v1/admin/shops/[id]/extra-till/route.ts": ["POST", "DELETE"],
  "app/api/v1/admin/shops/[id]/grant/route.ts": ["POST", "DELETE"],
  "app/api/v1/admin/shops/[id]/members/route.ts": ["POST"],
  "app/api/v1/admin/shops/[id]/members/[memberId]/route.ts": ["PATCH"],
  "app/api/v1/admin/shops/[id]/members/[memberId]/password-reset/route.ts": ["POST"],
};

test("every admin action route gates on staff and answers the admin 404 for each other method", () => {
  for (const [file, implemented] of Object.entries(ADMIN_ROUTES)) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const method of ADMIN_ROUTE_METHODS) {
      if (implemented.includes(method)) {
        const handler = source.split(`export async function ${method}(`)[1];
        assert.ok(handler, `${file} implements ${method}`);
        assert.match(handler.slice(0, 300), /requireStaff\(\)[\s\S]*adminNotFound\(\)/, `${file} ${method} checks staff first`);
      } else {
        assert.ok(source.includes(`export const ${method} = adminNotFound;`), `${file} exports ${method} as adminNotFound`);
      }
    }
  }
});
