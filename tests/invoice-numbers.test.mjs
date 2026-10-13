import assert from "node:assert/strict";
import test from "node:test";
import { dubaiDateCode, dubaiSupplyDate, nextCreditNoteNumber, nextInvoiceNumber } from "../lib/invoice-numbers.ts";

const at = new Date("2026-10-13T21:30:00Z"); // 01:30 on 14 Oct in Dubai

test("dates use the Dubai business day", () => {
  assert.equal(dubaiDateCode(at), "261014");
  assert.equal(dubaiSupplyDate(at), "2026-10-14");
});

test("each till has its own daily sequence", () => {
  const existing = ["SMK-1-261014-0001", "SMK-1-261014-0002", "SMK-2-261014-0001", "SMK-1-261013-0009"];
  assert.equal(nextInvoiceNumber("SMK", 1, at, existing), "SMK-1-261014-0003");
  assert.equal(nextInvoiceNumber("SMK", 2, at, existing), "SMK-2-261014-0002");
  assert.equal(nextInvoiceNumber("SMK", 3, at, existing), "SMK-3-261014-0001");
});

test("legacy numbers without a till and other prefixes are ignored", () => {
  assert.equal(nextInvoiceNumber("SMK", 1, at, ["SMK-261014-0007", "ABC-1-261014-0004"]), "SMK-1-261014-0001");
});

test("prefixes containing regex characters are matched literally", () => {
  assert.equal(nextInvoiceNumber("A-B", 1, at, ["A-B-1-261014-0001", "AXB-1-261014-0005"]), "A-B-1-261014-0002");
});

test("credit notes follow the same per-till rule", () => {
  assert.equal(nextCreditNoteNumber(2, at, ["CN-2-261014-0001", "CN-1-261014-0004"]), "CN-2-261014-0002");
});

test("till numbers must be positive integers", () => {
  assert.throws(() => nextInvoiceNumber("SMK", 0, at, []), RangeError);
  assert.throws(() => nextCreditNoteNumber(1.5, at, []), RangeError);
});
