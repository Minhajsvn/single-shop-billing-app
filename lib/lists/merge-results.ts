import type { PaymentMethod, Sale } from "../domain.ts";
import { saleMatches } from "./search.ts";

/** One row of a sales list, from the local store or from the server search. */
export type SaleRow = {
  id: string;
  invoiceNumber: string;
  customerName?: string;
  customerPhone?: string;
  supplyDate: string;
  createdAt: string;
  paymentMethod: PaymentMethod;
  grossFils: number;
  /** Not yet on the server (made offline or still syncing). */
  local?: true;
};

export function saleToRow(sale: Sale): SaleRow {
  return {
    id: sale.id,
    invoiceNumber: sale.invoiceNumber,
    ...(sale.customer?.name ? { customerName: sale.customer.name } : {}),
    ...(sale.customer?.phone ? { customerPhone: sale.customer.phone } : {}),
    supplyDate: sale.supplyDate,
    createdAt: sale.createdAt,
    paymentMethod: sale.paymentMethod,
    grossFils: sale.grossFils,
  };
}

/** Server results plus this browser's unsynced sales that match the same search and dates, each once, newest first. */
export function mergeUnsyncedSales(serverRows: SaleRow[], unsynced: Sale[], query: string, range: { from: string | null; to: string }): SaleRow[] {
  const known = new Set(serverRows.map((row) => row.id));
  const extra = unsynced
    .filter((sale) => !known.has(sale.id) && saleMatches(sale, query) && (!range.from || sale.supplyDate >= range.from) && sale.supplyDate <= range.to)
    .map((sale) => ({ ...saleToRow(sale), local: true as const }));
  return [...extra, ...serverRows].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
