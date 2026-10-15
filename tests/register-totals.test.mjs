import assert from "node:assert/strict";
import test from "node:test";
import { registerTotals } from "../lib/store/register-totals.ts";

const register = { id: "r1", status: "open", openedAt: "2026-10-14T04:00:00Z", openingCashFils: 10000, adjustments: [{ id: "a1", amountFils: -500, reason: "Petty", createdAt: "2026-10-14T05:00:00Z" }] };
const sale = (id, deviceId, paymentMethod, grossFils, createdAt = "2026-10-14T09:00:00Z") => ({ id, invoiceNumber: id, deviceId, createdAt, supplyDate: "2026-10-14", paymentMethod, lines: [], netFils: grossFils, vatFils: 0, grossFils, status: "completed" });
const note = (id, deviceId, paymentMethod, grossFils) => ({ id, creditNoteNumber: id, saleId: "x", invoiceNumber: "x", deviceId, createdAt: "2026-10-14T10:00:00Z", paymentMethod, lines: [], netFils: grossFils, vatFils: 0, grossFils });
const base = { products: [], stockMovements: [], customers: [], syncOperations: [], register };

test("only this till's sales and refunds count toward its drawer", () => {
  const state = { ...base, sales: [sale("t1-a", "dev-1", "cash", 5700), sale("t2-a", "dev-2", "cash", 2850), sale("t1-card", "dev-1", "card", 1000)], creditNotes: [note("t2-cn", "dev-2", "cash", 2850), note("t1-cn", "dev-1", "cash", 700)] };
  const totals = registerTotals(state, "dev-1");
  assert.equal(totals.cashSalesFils, 5700);
  assert.equal(totals.cardSalesFils, 1000);
  assert.equal(totals.cashReturnsFils, 700);
  assert.equal(totals.expectedCashFils, 10000 + 5700 - 700 - 500);
});

test("browser-only stores without device ids keep counting every sale", () => {
  const state = { ...base, sales: [sale("a", undefined, "cash", 5700), sale("b", undefined, "cash", 2850)], creditNotes: [] };
  assert.equal(registerTotals(state, null).cashSalesFils, 8550);
});

test("sales outside the register's open window are ignored", () => {
  const state = { ...base, sales: [sale("early", "dev-1", "cash", 9999, "2026-10-14T03:00:00Z"), sale("in", "dev-1", "cash", 100)], creditNotes: [] };
  assert.equal(registerTotals(state, "dev-1").cashSalesFils, 100);
});

test("no register means zero totals", () => {
  assert.equal(registerTotals({ ...base, register: null, sales: [], creditNotes: [] }, "dev-1").expectedCashFils, 0);
});
