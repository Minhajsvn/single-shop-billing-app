import assert from "node:assert/strict";
import test from "node:test";
import { SAMPLE_MODE_COOKIE, routeDecision } from "../lib/auth/access-rules.ts";

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

test("the cookie name is shared with the client store", () => {
  assert.equal(SAMPLE_MODE_COOKIE, "shop-ledger-mode");
});
