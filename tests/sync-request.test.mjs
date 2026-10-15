import assert from "node:assert/strict";
import test from "node:test";
import { requestSchema, rpcPayloadFor } from "../lib/sync/request-schema.ts";

const deviceId = "d0000000-0000-4000-8000-00000000000a";
const customer = { id: "c0000000-0000-4000-8000-000000000001", name: "Omar", phone: "+971 55 555 0198", createdAt: "2026-10-14T08:00:00Z", updatedAt: "2026-10-14T08:00:00Z" };
const register = { id: "e0000000-0000-4000-8000-000000000001", status: "open", openedAt: "2026-10-14T04:00:00Z", openingCashFils: 10000, adjustments: [] };
const base = (entity, entityId, payload) => ({ id: "0p000000-0000-4000-8000-000000000001".replace("p", "0"), entity, entityId, createdAt: "2026-10-14T08:00:00Z", payload });

test("deviceId survives validation on every operation type", () => {
  const parsed = requestSchema.parse({ operations: [
    base("customer", customer.id, { customer, deviceId }),
    base("register", register.id, { action: "open", register, deviceId }),
  ] });
  assert.equal(parsed.operations[0].payload.deviceId, deviceId);
  assert.equal(parsed.operations[1].payload.deviceId, deviceId);
});

test("operations queued before Stage 1B (no deviceId) are still accepted", () => {
  const parsed = requestSchema.parse({ operations: [base("customer", customer.id, { customer })] });
  assert.equal(parsed.operations[0].payload.deviceId, undefined);
});

test("a malformed deviceId is rejected", () => {
  assert.equal(requestSchema.safeParse({ operations: [base("customer", customer.id, { customer, deviceId: "till-1" })] }).success, false);
});

test("customer RPC payload is the customer object with the deviceId merged in", () => {
  const [operation] = requestSchema.parse({ operations: [base("customer", customer.id, { customer, deviceId })] }).operations;
  assert.deepEqual(rpcPayloadFor(operation), { ...customer, deviceId });
});

test("other RPC payloads pass through with their deviceId", () => {
  const [operation] = requestSchema.parse({ operations: [base("register", register.id, { action: "open", register, deviceId })] }).operations;
  assert.equal(rpcPayloadFor(operation).deviceId, deviceId);
  assert.equal(rpcPayloadFor(operation).action, "open");
});
