import type { DemoState } from "../domain.ts";

/**
 * Drawer totals for the register open on this till. Hosted shops share one sales list across tills, so only
 * documents issued by this device count; browser-only stores (no device ids) count every document.
 */
export function registerTotals(source: DemoState, deviceId: string | null) {
  const register = source.register;
  if (!register) return { cashSalesFils: 0, cardSalesFils: 0, cashReturnsFils: 0, cardReturnsFils: 0, adjustmentsFils: 0, expectedCashFils: 0 };
  const thisTill = (documentDeviceId: string | undefined) => !deviceId || !documentDeviceId || documentDeviceId === deviceId;
  const inWindow = (createdAt: string) => createdAt >= register.openedAt && (!register.closedAt || createdAt <= register.closedAt);
  const sales = source.sales.filter((sale) => thisTill(sale.deviceId) && inWindow(sale.createdAt));
  const creditNotes = source.creditNotes.filter((note) => thisTill(note.deviceId) && inWindow(note.createdAt));
  const cashSalesFils = sales.filter((sale) => sale.paymentMethod === "cash").reduce((sum, sale) => sum + sale.grossFils, 0);
  const cardSalesFils = sales.filter((sale) => sale.paymentMethod === "card").reduce((sum, sale) => sum + sale.grossFils, 0);
  const cashReturnsFils = creditNotes.filter((note) => note.paymentMethod === "cash").reduce((sum, note) => sum + note.grossFils, 0);
  const cardReturnsFils = creditNotes.filter((note) => note.paymentMethod === "card").reduce((sum, note) => sum + note.grossFils, 0);
  const adjustmentsFils = register.adjustments.reduce((sum, adjustment) => sum + adjustment.amountFils, 0);
  return { cashSalesFils, cardSalesFils, cashReturnsFils, cardReturnsFils, adjustmentsFils, expectedCashFils: register.openingCashFils + cashSalesFils - cashReturnsFils + adjustmentsFils };
}
