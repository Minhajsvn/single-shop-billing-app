import assert from "node:assert/strict";
import test from "node:test";
import { SAMPLE_MODE_COOKIE, routeDecision, safeNextPath } from "../lib/auth/access-rules.ts";

test("signed-out visitors are sent to login", () => {
  assert.equal(routeDecision({ signedIn: false, pathname: "/overview", sampleCookie: undefined }), "login");
});

test("the explicit sample shop is reachable without an account", () => {
  assert.equal(routeDecision({ signedIn: false, pathname: "/overview", sampleCookie: "sample" }), "allow");
});

test("only the exact sample value unlocks sample mode", () => {
  assert.equal(routeDecision({ signedIn: false, pathname: "/overview", sampleCookie: "hosted" }), "login");
  assert.equal(routeDecision({ signedIn: false, pathname: "/overview", sampleCookie: "" }), "login");
});

test("signed-in users skip the login page", () => {
  assert.equal(routeDecision({ signedIn: true, pathname: "/login", sampleCookie: undefined }), "overview");
  assert.equal(routeDecision({ signedIn: true, pathname: "/sale", sampleCookie: "sample" }), "allow");
});

test("the login page itself is always reachable when signed out", () => {
  assert.equal(routeDecision({ signedIn: false, pathname: "/login", sampleCookie: undefined }), "allow");
});

test("an auth outage does not log out a browser that still holds a session", () => {
  assert.equal(routeDecision({ signedIn: false, pathname: "/sale", sampleCookie: undefined, authUnavailable: true, hasSessionCookie: true }), "allow");
});

test("an auth outage never lets a browser without a session through", () => {
  assert.equal(routeDecision({ signedIn: false, pathname: "/sale", sampleCookie: undefined, authUnavailable: true, hasSessionCookie: false }), "login");
});

test("a reachable auth server that rejects the session still sends to login", () => {
  assert.equal(routeDecision({ signedIn: false, pathname: "/sale", sampleCookie: undefined, authUnavailable: false, hasSessionCookie: true }), "login");
});

test("signup, password reset and email links are reachable when signed out", () => {
  for (const pathname of ["/signup", "/forgot-password", "/reset-password", "/auth/confirm"]) {
    assert.equal(routeDecision({ signedIn: false, pathname, sampleCookie: undefined }), "allow", pathname);
  }
});

test("signed-in users skip signup but can still use email links and reset", () => {
  assert.equal(routeDecision({ signedIn: true, pathname: "/signup", sampleCookie: undefined }), "overview");
  assert.equal(routeDecision({ signedIn: true, pathname: "/auth/confirm", sampleCookie: undefined }), "allow");
  assert.equal(routeDecision({ signedIn: true, pathname: "/reset-password", sampleCookie: undefined }), "allow");
});

test("a lookalike path is not public", () => {
  assert.equal(routeDecision({ signedIn: false, pathname: "/signup-admin", sampleCookie: undefined }), "login");
});

test("the cookie name is shared with the client store", () => {
  assert.equal(SAMPLE_MODE_COOKIE, "shop-ledger-mode");
});

test("sign-in returns to the page that asked for it", () => {
  assert.equal(safeNextPath("/admin"), "/admin");
  assert.equal(safeNextPath("/admin/shops/42c1c75a-8435-4895-b9cb-d23271e39280"), "/admin/shops/42c1c75a-8435-4895-b9cb-d23271e39280");
  assert.equal(safeNextPath("/sales/sale-001"), "/sales/sale-001");
});

test("a missing or empty next goes to the overview", () => {
  assert.equal(safeNextPath(undefined), "/overview");
  assert.equal(safeNextPath(""), "/overview");
  assert.equal(safeNextPath(["/admin", "/sale"]), "/overview");
});

test("next never leaves the site", () => {
  for (const raw of ["https://evil.example", "//evil.example", "/\\evil.example", "\\evil.example", "javascript:alert(1)", "admin", "/%2F%2Fevil.example", " /admin"]) {
    assert.equal(safeNextPath(raw), "/overview", raw);
  }
});

test("next never loops back to a signed-out page", () => {
  for (const raw of ["/login", "/signup", "/login?next=/admin"]) assert.equal(safeNextPath(raw), "/overview", raw);
});
