import assert from "node:assert/strict";
import test from "node:test";
import { canSplit, methodTotals, paymentsOf, restOn, splitSummary, summaryMethod, toPayments } from "../lib/payments/split.ts";

let n = 0;
const gen = () => `p${++n}`;

test("splitSummary: left to pay, change on the cash part only", () => {
  assert.deepEqual(splitSummary(7720, { cash: 5000, card: 2720 }, 10000), { leftFils: 0, changeFils: 5000, ok: true });
  const short = splitSummary(7720, { cash: 5000, card: 2700 }, 10000);
  assert.equal(short.leftFils, 20);
  assert.equal(short.ok, false);
  assert.equal(splitSummary(7720, { cash: 5000, card: 2720 }, 4000).ok, false, "cash received below the cash part");
  assert.deepEqual(splitSummary(7720, { card: 2720, transfer: 5000 }, null), { leftFils: 0, changeFils: null, ok: true });
  assert.equal(splitSummary(7720, { cash: 7720, card: 0 }, null).ok, true, "a zero line is simply unused");
  assert.equal(splitSummary(7720, { cash: 8000 }, null).ok, false, "over the total");
});

test("restOn: fills one line with what is left, never zero or negative", () => {
  assert.deepEqual(restOn(7720, { cash: 5000 }, "card"), { cash: 5000, card: 2720 });
  assert.deepEqual(restOn(7720, { cash: 5000, card: 100 }, "card"), { cash: 5000, card: 2720 }, "replaces the line's own amount");
  assert.deepEqual(restOn(7720, { cash: 8000 }, "card"), { cash: 8000 }, "nothing left: unchanged");
  assert.deepEqual(restOn(7720, {}, "transfer"), { transfer: 7720 });
});

test("toPayments: drops empty lines, keeps a trimmed reference only on transfer", () => {
  const payments = toPayments({ cash: 5000, card: 0, transfer: 2720 }, ` ${"x".repeat(70)} `, gen);
  assert.deepEqual(payments.map((p) => p.method), ["cash", "transfer"]);
  assert.equal(payments[0].reference, undefined);
  assert.equal(payments[1].reference.length, 60);
  assert.equal(toPayments({ transfer: 100 }, "   ", gen)[0].reference, undefined);
});

test("paymentsOf: the document's rows, or one row from its method for older records", () => {
  assert.deepEqual(paymentsOf({ id: "s1", paymentMethod: "card", grossFils: 500 }), [{ id: "s1-card", method: "card", amountFils: 500 }]);
  const rows = [{ id: "a", method: "cash", amountFils: 1 }];
  assert.equal(paymentsOf({ id: "s2", paymentMethod: "cash", grossFils: 1, payments: rows }), rows);
});

test("summaryMethod, methodTotals and canSplit", () => {
  assert.equal(summaryMethod([{ id: "a", method: "transfer", amountFils: 1 }]), "transfer");
  assert.equal(summaryMethod([{ id: "a", method: "cash", amountFils: 1 }, { id: "b", method: "card", amountFils: 1 }]), "split");
  assert.deepEqual(methodTotals([{ id: "a", method: "cash", amountFils: 3 }, { id: "b", method: "card", amountFils: 4 }]), { cash: 3, card: 4, transfer: 0 });
  assert.equal(canSplit(["staff_roles"]), false);
  assert.equal(canSplit(["split_payment"]), true);
});

test("Stage 2B: the daily report splits totals by payment and the CSV keeps its old columns first", async () => {
  const { buildDailyReport, dailyReportCsv } = await import("../lib/reporting.ts");
  const day = "2026-11-09";
  const mk = (id, paymentMethod, grossFils, payments) => ({ id, invoiceNumber: id, createdAt: `${day}T08:00:00Z`, supplyDate: day, paymentMethod, lines: [], netFils: grossFils, vatFils: 0, grossFils, status: "completed", payments });
  const state = { products: [], stockMovements: [], customers: [], syncOperations: [], register: null, creditNotes: [],
    sales: [mk("a", "split", 7720, [{ id: "1", method: "cash", amountFils: 5000 }, { id: "2", method: "transfer", amountFils: 2720 }]), mk("b", "card", 100)] };
  const report = buildDailyReport(state, day);
  assert.equal(report.cashFils, 5000);
  assert.equal(report.cardFils, 100);
  assert.equal(report.transferFils, 2720);
  const [header, first] = dailyReportCsv(report).split("\r\n");
  assert.ok(header.startsWith('"Document type","Document number","Issued (UTC)","Customer","Payment","Net AED","VAT AED","Gross AED"'));
  assert.ok(header.endsWith('"Cash AED","Card AED","Transfer AED"'));
  assert.ok(first.includes('"split"'));
});
