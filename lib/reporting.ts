import type { CreditNote, DemoState, Sale } from "@/lib/domain";

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
  paymentMethod: "cash" | "card";
  customer: string;
  netFils: number;
  vatFils: number;
  grossFils: number;
};

export function buildDailyReport(state: DemoState, date: string) {
  const sales = state.sales.filter((sale) => sale.supplyDate === date);
  const creditNotes = state.creditNotes.filter((note) => uaeBusinessDate(note.createdAt) === date);
  const sum = <T extends Sale | CreditNote>(items: T[], field: "netFils" | "vatFils" | "grossFils") => items.reduce((total, item) => total + item[field], 0);
  const cashSalesFils = sum(sales.filter((sale) => sale.paymentMethod === "cash"), "grossFils");
  const cardSalesFils = sum(sales.filter((sale) => sale.paymentMethod === "card"), "grossFils");
  const cashReturnsFils = sum(creditNotes.filter((note) => note.paymentMethod === "cash"), "grossFils");
  const cardReturnsFils = sum(creditNotes.filter((note) => note.paymentMethod === "card"), "grossFils");
  const register = state.register && uaeBusinessDate(state.register.openedAt) === date ? state.register : null;
  const transactions: ReportTransaction[] = [
    ...sales.map((sale) => ({ id: sale.id, type: "invoice" as const, number: sale.invoiceNumber, createdAt: sale.createdAt, paymentMethod: sale.paymentMethod, customer: sale.customer?.name ?? "Walk-in", netFils: sale.netFils, vatFils: sale.vatFils, grossFils: sale.grossFils })),
    ...creditNotes.map((note) => {
      const sale = state.sales.find((item) => item.id === note.saleId);
      return { id: note.id, type: "credit-note" as const, number: note.creditNoteNumber, createdAt: note.createdAt, paymentMethod: note.paymentMethod, customer: sale?.customer?.name ?? "Walk-in", netFils: -note.netFils, vatFils: -note.vatFils, grossFils: -note.grossFils };
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
    cashFils: cashSalesFils - cashReturnsFils,
    cardFils: cardSalesFils - cardReturnsFils,
    returnsFils: cashReturnsFils + cardReturnsFils,
    register,
  };
}

function safeCsv(value: string | number) {
  const raw = String(value);
  const protectedValue = /^[=+@-]/.test(raw) ? `'${raw}` : raw;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

export function dailyReportCsv(report: ReturnType<typeof buildDailyReport>) {
  const header = ["Document type", "Document number", "Issued (UTC)", "Customer", "Payment", "Net AED", "VAT AED", "Gross AED"];
  const rows = report.transactions.map((item) => [item.type, item.number, item.createdAt, item.customer, item.paymentMethod, (item.netFils / 100).toFixed(2), (item.vatFils / 100).toFixed(2), (item.grossFils / 100).toFixed(2)]);
  return [header, ...rows].map((row) => row.map(safeCsv).join(",")).join("\r\n");
}
