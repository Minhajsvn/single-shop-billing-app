import assert from "node:assert/strict";
import test from "node:test";
import { costPreview, defaultInvoiceDate, draftTotals, mergeLines, validateDraft } from "../lib/purchasing/draft.ts";
import { purchasesCsv } from "../lib/purchasing/csv.ts";

test("mergeLines adds a repeat scan to the existing line and keeps its cost", () => {
  let lines = mergeLines([], { productId: "p1", unitCostFils: 500 });
  lines = mergeLines(lines, { productId: "p2", unitCostFils: 250 });
  lines = mergeLines(lines, { productId: "p1", unitCostFils: 999 });
  assert.deepEqual(lines, [{ productId: "p1", quantity: 2, unitCostFils: 500 }, { productId: "p2", quantity: 1, unitCostFils: 250 }]);
});

test("draftTotals: VAT defaults to 5% of net, an override is kept", () => {
  const lines = [{ productId: "p1", quantity: 10, unitCostFils: 600 }, { productId: "p2", quantity: 5, unitCostFils: 250 }];
  assert.deepEqual(draftTotals(lines, null), { netFils: 7250, vatFils: 363, grossFils: 7613 });
  assert.deepEqual(draftTotals(lines, 360), { netFils: 7250, vatFils: 360, grossFils: 7610 });
  assert.deepEqual(draftTotals([], null), { netFils: 0, vatFils: 0, grossFils: 0 });
});

test("costPreview matches the SQL formula", () => {
  assert.equal(costPreview(10, 500, 10, 600), 550);
  assert.equal(costPreview(0, null, 5, 250), 250);
  assert.equal(costPreview(-3, 400, 10, 700), 700);
  assert.equal(costPreview(10, 700, 10, 0), 350);
  assert.equal(costPreview(5, 0, 5, 0), 0);
  assert.equal(costPreview(3, 333, 1, 334), 333); // (999 + 334) / 4 = 333.25 → 333
});

test("validateDraft: the first problem in plain words", () => {
  const line = { productId: "p1", quantity: 1, unitCostFils: 100 };
  assert.equal(validateDraft({ supplierId: null, lines: [line], vatFils: 0 }), "Choose a supplier.");
  assert.equal(validateDraft({ supplierId: "s", lines: [], vatFils: 0 }), "Add at least one product.");
  assert.equal(validateDraft({ supplierId: "s", lines: [{ ...line, quantity: 0 }], vatFils: 0 }), "Quantities must be whole numbers from 1 to 100,000.");
  assert.equal(validateDraft({ supplierId: "s", lines: [{ ...line, quantity: 1.5 }], vatFils: 0 }), "Quantities must be whole numbers from 1 to 100,000.");
  assert.equal(validateDraft({ supplierId: "s", lines: [{ ...line, unitCostFils: 100000001 }], vatFils: 0 }), "Unit costs must be from 0 to 1,000,000 AED.");
  assert.equal(validateDraft({ supplierId: "s", lines: [line], vatFils: 101 }), "VAT cannot be more than the net amount.");
  assert.equal(validateDraft({ supplierId: "s", lines: Array.from({ length: 201 }, (_, i) => ({ ...line, productId: `p${i}` })), vatFils: 0 }), "A delivery can have at most 200 lines.");
  assert.equal(validateDraft({ supplierId: "s", lines: [line], vatFils: 5 }), null);
});

test("defaultInvoiceDate uses Dubai", () => {
  assert.equal(defaultInvoiceDate(new Date("2026-12-31T21:30:00Z")), "2027-01-01");
  assert.equal(defaultInvoiceDate(new Date("2026-11-11T08:00:00Z")), "2026-11-11");
});

test("purchasesCsv: fixed headings, AED amounts, voided flag, safe quoting", () => {
  const rows = [
    { id: "r1", supplierId: "s1", supplierName: "=Al Noor", supplierTrn: "100000000000003", supplierInvoice: "INV-1", invoiceDate: "2026-11-11", lineCount: 2, netFils: 7250, vatFils: 363, grossFils: 7613, createdAt: "x", voidedAt: null },
    { id: "r2", supplierId: "s1", supplierName: "Gulf", supplierTrn: null, supplierInvoice: null, invoiceDate: "2026-11-10", lineCount: 1, netFils: 100, vatFils: 0, grossFils: 100, createdAt: "x", voidedAt: "2026-11-11T00:00:00Z" },
  ];
  const lines = purchasesCsv(rows).split("\r\n");
  assert.equal(lines[0], '"Date","Supplier","Supplier TRN","Invoice no.","Net AED","VAT AED","Gross AED","Voided"');
  assert.equal(lines[1], `"2026-11-11","'=Al Noor","100000000000003","INV-1","72.50","3.63","76.13",""`);
  assert.equal(lines[2], '"2026-11-10","Gulf","","","1.00","0.00","1.00","Yes"');
});
