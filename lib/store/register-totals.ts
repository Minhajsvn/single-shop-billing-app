import type { DemoState } from "../domain.ts";
import { methodTotals, paymentsOf } from "../payments/split.ts";

/**
 * Drawer totals for the register open on this till. Hosted shops share one sales list across tills, so only
 * documents issued by this device count; browser-only stores (no device ids) count every document.
 * Stage 2B: amounts come from each document's payment rows; only cash is expected in the drawer.
 */
export function registerTotals(source: DemoState, deviceId: string | null) {
  const register = source.register;
  if (!register) return { cashSalesFils: 0, cardSalesFils: 0, transferSalesFils: 0, cashReturnsFils: 0, cardReturnsFils: 0, transferReturnsFils: 0, adjustmentsFils: 0, expectedCashFils: 0 };
  const thisTill = (documentDeviceId: string | undefined) => !deviceId || !documentDeviceId || documentDeviceId === deviceId;
  const inWindow = (createdAt: string) => createdAt >= register.openedAt && (!register.closedAt || createdAt <= register.closedAt);
  const sales = methodTotals(source.sales.filter((sale) => thisTill(sale.deviceId) && inWindow(sale.createdAt)).flatMap(paymentsOf));
  const returns = methodTotals(source.creditNotes.filter((note) => thisTill(note.deviceId) && inWindow(note.createdAt)).flatMap(paymentsOf));
  const adjustmentsFils = register.adjustments.reduce((sum, adjustment) => sum + adjustment.amountFils, 0);
  return {
    cashSalesFils: sales.cash, cardSalesFils: sales.card, transferSalesFils: sales.transfer,
    cashReturnsFils: returns.cash, cardReturnsFils: returns.card, transferReturnsFils: returns.transfer,
    adjustmentsFils,
    expectedCashFils: register.openingCashFils + sales.cash - returns.cash + adjustmentsFils,
  };
}
