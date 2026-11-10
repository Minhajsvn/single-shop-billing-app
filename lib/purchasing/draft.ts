// Stage 2D: the delivery being typed on the record page. Pure, so the page and the tests share it.
import { uaeBusinessDate } from "../reporting.ts";

export type DraftLine = { productId: string; quantity: number; unitCostFils: number };

export const MAX_LINES = 200;
export const MAX_QUANTITY = 100_000;
export const MAX_UNIT_COST_FILS = 100_000_000;
const VAT_RATE = 0.05;

/** Adds a product; a product already on the delivery (a second scan) gets one more and keeps its cost. */
export function mergeLines(lines: DraftLine[], add: { productId: string; unitCostFils: number }): DraftLine[] {
  if (lines.some((line) => line.productId === add.productId)) {
    return lines.map((line) => line.productId === add.productId ? { ...line, quantity: line.quantity + 1 } : line);
  }
  return [...lines, { productId: add.productId, quantity: 1, unitCostFils: add.unitCostFils }];
}

/** Net from the lines; VAT is 5% of net unless the owner typed the invoice's figure. */
export function draftTotals(lines: DraftLine[], vatOverride: number | null): { netFils: number; vatFils: number; grossFils: number } {
  const netFils = lines.reduce((sum, line) => sum + line.quantity * line.unitCostFils, 0);
  const vatFils = vatOverride ?? Math.round(netFils * VAT_RATE);
  return { netFils, vatFils, grossFils: netFils + vatFils };
}

/** The product's cost after this line, by the server's weighted-average formula (202611110058). */
export function costPreview(stock: number, costFils: number | null, quantity: number, unitCostFils: number): number {
  const base = Math.max(stock, 0);
  return Math.round((base * (costFils ?? unitCostFils) + quantity * unitCostFils) / (base + quantity));
}

/** The first thing stopping a save, in the owner's words; null when the delivery can be sent. */
export function validateDraft(draft: { supplierId: string | null; lines: DraftLine[]; vatFils: number }): string | null {
  if (!draft.supplierId) return "Choose a supplier.";
  if (!draft.lines.length) return "Add at least one product.";
  if (draft.lines.length > MAX_LINES) return "A delivery can have at most 200 lines.";
  if (draft.lines.some((line) => !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QUANTITY)) return "Quantities must be whole numbers from 1 to 100,000.";
  if (draft.lines.some((line) => !Number.isInteger(line.unitCostFils) || line.unitCostFils < 0 || line.unitCostFils > MAX_UNIT_COST_FILS)) return "Unit costs must be from 0 to 1,000,000 AED.";
  const { netFils } = draftTotals(draft.lines, 0);
  if (!Number.isInteger(draft.vatFils) || draft.vatFils < 0 || draft.vatFils > netFils) return "VAT cannot be more than the net amount.";
  return null;
}

export function defaultInvoiceDate(now: Date): string {
  return uaeBusinessDate(now);
}
