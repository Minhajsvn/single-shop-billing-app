import assert from "node:assert/strict";
import test from "node:test";
import { hashPin, isValidPin, verifyPin } from "../lib/staff/pin.ts";
import { blockedFor, recordFailure, recordSuccess } from "../lib/staff/lockout.ts";

const SALT = "BwcHBwcHBwcHBwcHBwcHBw==";
const HASH_1234 = "JpGjAh9aPug1yuS6zmq1z8aMM0a3EHBhmBDCxrUiWqk=";

test("isValidPin: exactly four digits", () => {
  assert.equal(isValidPin("1234"), true);
  assert.equal(isValidPin("0000"), true);
  for (const bad of ["123", "12345", "12a4", " 1234", "1234 ", "", "١٢٣٤"]) assert.equal(isValidPin(bad), false, bad);
});

test("hashPin: PBKDF2-SHA256, 100,000 rounds, 32 bytes, matches a fixed vector", async () => {
  assert.deepEqual(await hashPin("1234", SALT), { hash: HASH_1234, salt: SALT });
});

test("hashPin: a new random 16-byte salt each time when none is given", async () => {
  const a = await hashPin("1234");
  const b = await hashPin("1234");
  assert.notEqual(a.salt, b.salt);
  assert.equal(Buffer.from(a.salt, "base64").length, 16);
  assert.equal(a.hash.length, 44);
  assert.equal(a.salt.length, 24);
});

test("verifyPin: right PIN true, wrong PIN false, malformed stored values false", async () => {
  assert.equal(await verifyPin("1234", HASH_1234, SALT), true);
  assert.equal(await verifyPin("1235", HASH_1234, SALT), false);
  assert.equal(await verifyPin("12", HASH_1234, SALT), false);
  assert.equal(await verifyPin("1234", "short", SALT), false);
});

test("lockout: the fifth wrong PIN blocks that person for 5 minutes, then frees them", () => {
  let state = {};
  const now = 1_000_000;
  for (let i = 0; i < 4; i += 1) state = recordFailure(state, "m1", now);
  assert.equal(blockedFor(state, "m1", now), 0);
  state = recordFailure(state, "m1", now);
  assert.equal(blockedFor(state, "m1", now), 300_000);
  assert.equal(blockedFor(state, "m1", now + 299_999), 1);
  assert.equal(blockedFor(state, "m1", now + 300_000), 0);
  assert.equal(blockedFor(state, "m2", now), 0);
});

test("lockout: a correct PIN clears the count", () => {
  let state = {};
  for (let i = 0; i < 4; i += 1) state = recordFailure(state, "m1", 0);
  state = recordSuccess(state, "m1");
  state = recordFailure(state, "m1", 0);
  assert.equal(blockedFor(state, "m1", 0), 0);
});
