import type { CreditNote, DemoState, PaymentMethod, Sale } from "@/lib/domain";
import { methodTotals, paymentsOf } from "./payments/split.ts";

export function uaeBusinessDate(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export type ReportTransaction = {
  id: string;
  type: "invoice" | "credit-note";
  number: string;
  createdAt: string;
  paymentMethod: PaymentMethod;
  customer: string;
  /** Stage 2B: this document's amount per method (negative for refunds). */
  cashFils: number;
  cardFils: number;
  transferFils: number;
  netFils: number;
  vatFils: number;
  grossFils: number;
};

export function buildDailyReport(state: DemoState, date: string) {
  const sales = state.sales.filter((sale) => sale.supplyDate === date);
  const creditNotes = state.creditNotes.filter((note) => uaeBusinessDate(note.createdAt) === date);
  const sum = <T extends Sale | CreditNote>(items: T[], field: "netFils" | "vatFils" | "grossFils") => items.reduce((total, item) => total + item[field], 0);
  // Stage 2B: per-method totals come from payment rows (one row from the method for records made before 2B).
  const salesBy = methodTotals(sales.flatMap(paymentsOf));
  const returnsBy = methodTotals(creditNotes.flatMap(paymentsOf));
  const by = (doc: Sale | CreditNote, sign: number) => {
    const totals = methodTotals(paymentsOf(doc));
    return { cashFils: sign * totals.cash, cardFils: sign * totals.card, transferFils: sign * totals.transfer };
  };
  const register = state.register && uaeBusinessDate(state.register.openedAt) === date ? state.register : null;
  const transactions: ReportTransaction[] = [
    ...sales.map((sale) => ({ id: sale.id, type: "invoice" as const, number: sale.invoiceNumber, createdAt: sale.createdAt, paymentMethod: sale.paymentMethod, customer: sale.customer?.name ?? "Walk-in", netFils: sale.netFils, vatFils: sale.vatFils, grossFils: sale.grossFils, ...by(sale, 1) })),
    ...creditNotes.map((note) => {
      const sale = state.sales.find((item) => item.id === note.saleId);
      return { id: note.id, type: "credit-note" as const, number: note.creditNoteNumber, createdAt: note.createdAt, paymentMethod: note.paymentMethod, customer: sale?.customer?.name ?? "Walk-in", netFils: -note.netFils, vatFils: -note.vatFils, grossFils: -note.grossFils, ...by(note, -1) };
    }),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return {
    date,
    sales,
    creditNotes,
    transactions,
    invoiceCount: sales.length,
    creditNoteCount: creditNotes.length,
    grossFils: sum(sales, "grossFils") - sum(creditNotes, "grossFils"),
    netFils: sum(sales, "netFils") - sum(creditNotes, "netFils"),
    vatFils: sum(sales, "vatFils") - sum(creditNotes, "vatFils"),
    cashFils: salesBy.cash - returnsBy.cash,
    cardFils: salesBy.card - returnsBy.card,
    transferFils: salesBy.transfer - returnsBy.transfer,
    returnsFils: returnsBy.cash + returnsBy.card + returnsBy.transfer,
    // Stage 2E: what promotions took off the day's sales (a refund returns the charged price, so it does not change this).
    promotionSavingFils: sales.reduce((sum, sale) => sum + sale.lines.reduce((lineSum, line) => lineSum + (line.promotionSavingFils ?? 0), 0), 0),
    register,
  };
}

export function safeCsv(value: string | number) {
  const raw = String(value);
  const protectedValue = /^[=+@-]/.test(raw) ? `'${raw}` : raw;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

export function dailyReportCsv(report: ReturnType<typeof buildDailyReport>) {
  // Stage 2B: the original columns stay first and unchanged; the per-method amounts follow.
  const header = ["Document type", "Document number", "Issued (UTC)", "Customer", "Payment", "Net AED", "VAT AED", "Gross AED", "Cash AED", "Card AED", "Transfer AED"];
  const rows = report.transactions.map((item) => [item.type, item.number, item.createdAt, item.customer, item.paymentMethod, (item.netFils / 100).toFixed(2), (item.vatFils / 100).toFixed(2), (item.grossFils / 100).toFixed(2), (item.cashFils / 100).toFixed(2), (item.cardFils / 100).toFixed(2), (item.transferFils / 100).toFixed(2)]);
  return [header, ...rows].map((row) => row.map(safeCsv).join(",")).join("\r\n");
}
