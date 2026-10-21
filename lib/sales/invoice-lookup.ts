import type { CreditNote, Sale } from "../domain.ts";

/** A credit note already on the server for a sale found by invoice number: enough to know what is left to refund. */
export type InvoiceLookupCreditNote = { id: string; creditNoteNumber: string; createdAt: string; grossFils: number; lines: { saleItemId: string; quantity: number }[] };
export type InvoiceLookup = { sale: Sale; creditNotes: InvoiceLookupCreditNote[] };

/**
 * Quantities already refunded per sale line: this browser's credit notes for the sale plus the server's, each note
 * counted once (a local note that has synced comes back from the server with the same id).
 */
export function refundedQuantities(saleId: string, local: CreditNote[], server: InvoiceLookupCreditNote[] = []): Map<string, number> {
  const quantities = new Map<string, number>();
  const add = (lineId: string, quantity: number) => quantities.set(lineId, (quantities.get(lineId) ?? 0) + quantity);
  const localNotes = local.filter((note) => note.saleId === saleId);
  const known = new Set(localNotes.map((note) => note.id));
  for (const note of localNotes) for (const item of note.lines) add(item.originalLineId, item.quantity);
  for (const note of server) if (!known.has(note.id)) for (const item of note.lines) add(item.saleItemId, item.quantity);
  return quantities;
}
