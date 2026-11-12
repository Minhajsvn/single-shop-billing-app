// Stage 2D: the delivery being typed on the record page. Pure, so the page and the tests share it.
import { uaeBusinessDate } from "../reporting.ts";

/** Stage 2F: byWeight lines hold grams at a per-kg cost (a weighed product). */
export type DraftLine = { productId: string; quantity: number; unitCostFils: number; byWeight?: boolean };

export const MAX_LINES = 200;
export const MAX_QUANTITY = 100_000;
/** Stage 2F: a weighed line's grams (100,000 kg), as the server allows. */
export const MAX_GRAMS = 100_000_000;
export const MAX_UNIT_COST_FILS = 100_000_000;
const VAT_RATE = 0.05;

/**
 * Adds a product; a product already on the delivery (a second scan) gets one more and keeps its cost. Stage 2F: a
 * weighed product starts at 1 kg and a second scan leaves its weight alone (the owner types the kg).
 */
export function mergeLines(lines: DraftLine[], add: { productId: string; unitCostFils: number; byWeight?: boolean }): DraftLine[] {
  if (lines.some((line) => line.productId === add.productId)) {
    return lines.map((line) => line.productId === add.productId && !line.byWeight ? { ...line, quantity: line.quantity + 1 } : line);
  }
  return [...lines, add.byWeight ? { productId: add.productId, quantity: 1000, unitCostFils: add.unitCostFils, byWeight: true } : { productId: add.productId, quantity: 1, unitCostFils: add.unitCostFils }];
}

/** A line's net: quantity × cost, or grams × per-kg cost ÷ 1000 rounded (the server's rule). */
export function lineNetFils(line: DraftLine): number {
  return line.byWeight ? Math.round((line.quantity * line.unitCostFils) / 1000) : line.quantity * line.unitCostFils;
}

/** Net from the lines; VAT is 5% of net unless the owner typed the invoice's figure. */
export function draftTotals(lines: DraftLine[], vatOverride: number | null): { netFils: number; vatFils: number; grossFils: number } {
  const netFils = lines.reduce((sum, line) => sum + lineNetFils(line), 0);
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
  if (draft.lines.some((line) => line.byWeight && (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_GRAMS))) return "Weights must be from 0.001 to 100,000 kg.";
  if (draft.lines.some((line) => !line.byWeight && (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QUANTITY))) return "Quantities must be whole numbers from 1 to 100,000.";
  if (draft.lines.some((line) => !Number.isInteger(line.unitCostFils) || line.unitCostFils < 0 || line.unitCostFils > MAX_UNIT_COST_FILS)) return "Unit costs must be from 0 to 1,000,000 AED.";
  const { netFils } = draftTotals(draft.lines, 0);
  if (!Number.isInteger(draft.vatFils) || draft.vatFils < 0 || draft.vatFils > netFils) return "VAT cannot be more than the net amount.";
  return null;
}

export function defaultInvoiceDate(now: Date): string {
  return uaeBusinessDate(now);
}
