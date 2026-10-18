import assert from "node:assert/strict";
import test from "node:test";
import { chipIsServer, chipRange, localHistoryRange } from "../lib/lists/date-chips.ts";
import { mergeUnsyncedSales, saleToRow } from "../lib/lists/merge-results.ts";
import { paginate } from "../lib/lists/paging.ts";
import { customerMatches, normalizePhone, phoneMatches, saleMatches } from "../lib/lists/search.ts";

const omar = { id: "c1", name: "Omar Hassan", phone: "+971 55 555 0198", email: "omar@example.com", trn: "100000000000003", createdAt: "x", updatedAt: "x" };
const sale = (over = {}) => ({
  id: "s1", invoiceNumber: "SMK-1-261017-0042", createdAt: "2026-10-17T08:00:00.000Z", supplyDate: "2026-10-17", paymentMethod: "cash",
  lines: [], netFils: 100, vatFils: 5, grossFils: 105, status: "completed", customer: omar, ...over,
});

test("normalizePhone strips formatting, the UAE code and the trunk 0", () => {
  for (const phone of ["+971 55 555 0198", "0555550198", "55-555-0198", "00971555550198"]) assert.equal(normalizePhone(phone), "555550198", phone);
});

test("phoneMatches needs at least 4 digits", () => {
  assert.equal(phoneMatches("0198", "+971 55 555 0198"), true);
  assert.equal(phoneMatches("019", "+971 55 555 0198"), false);
  assert.equal(phoneMatches("1234", undefined), false);
});

test("saleMatches invoice, customer name and phone in any format", () => {
  assert.equal(saleMatches(sale(), "smk-1-2610"), true);
  assert.equal(saleMatches(sale(), "omar"), true);
  assert.equal(saleMatches(sale(), "0555550198"), true);
  assert.equal(saleMatches(sale(), ""), true);
  assert.equal(saleMatches(sale(), "zzz"), false);
  assert.equal(saleMatches(sale({ customer: undefined }), "omar"), false);
});

test("customerMatches name, email, TRN and phone", () => {
  assert.equal(customerMatches(omar, "0000000000"), true);
  assert.equal(customerMatches(omar, "55-555-0198"), true);
  assert.equal(customerMatches(omar, "EXAMPLE.COM"), true);
  assert.equal(customerMatches(omar, "mariam"), false);
});

test("paginate clamps pages and reports 1-based positions", () => {
  assert.deepEqual(paginate([], 1), { items: [], page: 1, pageCount: 1, from: 0, to: 0, total: 0 });
  const fifty = Array.from({ length: 50 }, (_, i) => i);
  assert.equal(paginate(fifty, 1).pageCount, 1);
  const fiftyOne = Array.from({ length: 51 }, (_, i) => i);
  const second = paginate(fiftyOne, 2);
  assert.deepEqual([second.pageCount, second.items, second.from, second.to], [2, [50], 51, 51]);
  assert.equal(paginate(fiftyOne, 3).page, 2);
  assert.equal(paginate(fiftyOne, 0).page, 1);
});

test("chipRange uses Dubai business dates", () => {
  const now = new Date("2026-10-17T19:35:00Z");
  assert.deepEqual(chipRange("last30", now), { from: "2026-09-18", to: "2026-10-17" });
  assert.deepEqual(chipRange("today", now), { from: "2026-10-17", to: "2026-10-17" });
  assert.deepEqual(chipRange("year", now), { from: "2026-01-01", to: "2026-10-17" });
  assert.deepEqual(chipRange("all", now), { from: null, to: "2026-10-17" });
  assert.equal(chipRange("today", new Date("2026-10-17T20:00:00Z")).from, "2026-10-18");
  assert.deepEqual(localHistoryRange(now), { from: "2026-07-20", to: "2026-10-17" });
});

test("only This year and All search the server", () => {
  assert.deepEqual(["last30", "today", "year", "all"].map(chipIsServer), [false, false, true, true]);
});

test("mergeUnsyncedSales adds matching unsynced sales once, newest first", () => {
  const server = [saleToRow(sale({ id: "srv", invoiceNumber: "SMK-1-261001-0001", createdAt: "2026-10-01T08:00:00.000Z", supplyDate: "2026-10-01" }))];
  const local = sale({ id: "loc", invoiceNumber: "SMK-1-261018-0001", createdAt: "2026-10-18T08:00:00.000Z", supplyDate: "2026-10-18" });
  const other = sale({ id: "other", invoiceNumber: "SMK-1-261018-0002", createdAt: "2026-10-18T09:00:00.000Z", supplyDate: "2026-10-18", customer: undefined });
  const merged = mergeUnsyncedSales(server, [local, other], "omar", { from: null, to: "2026-10-18" });
  assert.deepEqual(merged.map((row) => [row.id, row.local ?? false]), [["loc", true], ["srv", false]]);
  assert.equal(mergeUnsyncedSales(server, [sale({ id: "srv" })], "", { from: null, to: "2026-10-18" }).length, 1);
  assert.equal(mergeUnsyncedSales([], [sale({ supplyDate: "2025-01-01" })], "", { from: "2026-01-01", to: "2026-10-18" }).length, 0);
});
