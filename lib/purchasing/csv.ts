// Stage 2D: the accountant's purchases list (input VAT), one row per delivery. Same quoting as the daily report.
import { safeCsv } from "../reporting.ts";
import type { ReceiptSummary } from "./types.ts";

const aed = (fils: number) => (fils / 100).toFixed(2);

export function purchasesCsv(rows: ReceiptSummary[]): string {
  const table: (string | number)[][] = [
    ["Date", "Supplier", "Supplier TRN", "Invoice no.", "Net AED", "VAT AED", "Gross AED", "Voided"],
    ...rows.map((row) => [row.invoiceDate, row.supplierName, row.supplierTrn ?? "", row.supplierInvoice ?? "", aed(row.netFils), aed(row.vatFils), aed(row.grossFils), row.voidedAt ? "Yes" : ""]),
  ];
  return table.map((row) => row.map(safeCsv).join(",")).join("\r\n");
}
