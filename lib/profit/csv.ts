// Stage 2C: the Profit tab's tables as CSV, one file per table. Same quoting as the daily report.
import { safeCsv } from "../reporting.ts";
import type { ProfitReport } from "./types.ts";

const aed = (fils: number) => (fils / 100).toFixed(2);
const pct = (value: number | null) => (value === null ? "" : String(value));
const kg = (grams: number | null | undefined) => (grams === null || grams === undefined ? "" : (grams / 1000).toFixed(3));

export function profitCsv(kind: "day" | "category" | "product", report: ProfitReport): string {
  const rows: (string | number)[][] = kind === "day"
    ? [["Date", "Net AED", "Cost AED", "Profit AED"], ...report.byDay.map((row) => [row.date, aed(row.netFils), aed(row.costFils), aed(row.profitFils)])]
    : kind === "category"
      ? [["Category", "Net AED", "Cost AED", "Profit AED", "Margin %"], ...report.byCategory.map((row) => [row.name, aed(row.netFils), aed(row.costFils), aed(row.profitFils), pct(row.marginPct)])]
      : [["Product", "Quantity", "Kg sold", "Net AED", "Cost AED", "Profit AED", "Margin %"], ...report.byProduct.map((row) => [row.name, row.quantity, kg(row.weightGrams), aed(row.netFils), aed(row.costFils), aed(row.profitFils), pct(row.marginPct)])];
  return rows.map((row) => row.map(safeCsv).join(",")).join("\r\n");
}
