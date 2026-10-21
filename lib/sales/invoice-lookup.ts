import type { CreditNote, Sale } from "../domain.ts";

/** A credit note already on the server for a sale found by invoice number: enough to know what is left to refund. */
export type InvoiceLookupCreditNote = { id: string; creditNoteNumber: string; createdAt: string; grossFils: number; lines: { saleItemId: string; quantity: number }[] };
export type InvoiceLookup = { sale: Sale; creditNotes: InvoiceLookupCreditNote[] };

/**
 * "Refund a sale by invoice number" shows for every member of a hosted shop: a cashier and the owner alike refund a
 * returning customer's sale from its receipt (owner decision 8), so the role does not matter. The browser-only stores
 * hold every sale already.
 */
export function refundByInvoiceShown(mode: string): boolean {
  return mode === "hosted";
}

export type RemoteSaleSource = "none" | "by-invoice" | "by-id";

/**
 * Where /sales/<id> gets a sale this browser does not hold: found by its invoice number (`?invoice=`, any role; a
 * cashier always, since the by-id route is owner-only) or, for an owner opening an old sale from the list, by id.
 */
export function remoteSaleSource({ hasLocal, ownerView, hasInvoiceParam }: { hasLocal: boolean; ownerView: boolean; hasInvoiceParam: boolean }): RemoteSaleSource {
  if (hasLocal) return "none";
  return hasInvoiceParam || !ownerView ? "by-invoice" : "by-id";
}

/** Only a sale found by invoice number can be refunded from the server copy; one opened by id stays view-only (1E). */
export function remoteSaleRefundable(source: RemoteSaleSource): boolean {
  return source === "by-invoice";
}

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
