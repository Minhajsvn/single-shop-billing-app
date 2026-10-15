import { calculateVatInclusive } from "../domain.ts";

export type LineDiscount = { kind: "percent"; percent: number } | { kind: "amount"; offEachFils: number };

/** The price charged per unit after a per-item discount. Always whole fils, never free. */
export function discountedUnit(listUnitGrossFils: number, discount: LineDiscount): { ok: true; unitGrossFils: number } | { ok: false; error: string } {
  if (discount.kind === "percent") {
    if (!Number.isFinite(discount.percent) || discount.percent <= 0 || discount.percent >= 100) {
      return { ok: false, error: "Enter a discount above 0% and below 100%." };
    }
    const unitGrossFils = Math.round((listUnitGrossFils * (100 - discount.percent)) / 100);
    return unitGrossFils >= 1 ? { ok: true, unitGrossFils } : { ok: false, error: "That discount would make the item free." };
  }
  if (!Number.isInteger(discount.offEachFils) || discount.offEachFils <= 0) return { ok: false, error: "Enter an amount off each item." };
  const unitGrossFils = listUnitGrossFils - discount.offEachFils;
  return unitGrossFils >= 1 ? { ok: true, unitGrossFils } : { ok: false, error: "The discount must be less than the item price." };
}

/** Cart totals with VAT computed per line (as invoices are), plus the total saving from discounts. */
export function cartTotals(lines: { unitGrossFils: number; quantity: number; listUnitGrossFils?: number }[]) {
  return lines.reduce((totals, line) => {
    const amounts = calculateVatInclusive(line.unitGrossFils * line.quantity);
    const saving = line.listUnitGrossFils ? (line.listUnitGrossFils - line.unitGrossFils) * line.quantity : 0;
    return {
      netFils: totals.netFils + amounts.netFils,
      vatFils: totals.vatFils + amounts.vatFils,
      grossFils: totals.grossFils + amounts.grossFils,
      discountFils: totals.discountFils + saving,
    };
  }, { netFils: 0, vatFils: 0, grossFils: 0, discountFils: 0 });
}

export function changeDue(totalFils: number, tenderedFils: number): { ok: true; changeFils: number } | { ok: false; error: string } {
  if (!Number.isInteger(tenderedFils) || tenderedFils < totalFils) return { ok: false, error: "Cash received must cover the total." };
  return { ok: true, changeFils: tenderedFils - totalFils };
}

const NOTE_STEPS_FILS = [500, 1000, 5000, 10000, 20000, 50000, 100000];

/** One-tap cash amounts: the exact total, then the total rounded up to common AED notes. */
export function quickCashAmounts(totalFils: number): number[] {
  const amounts = [totalFils];
  for (const step of NOTE_STEPS_FILS) {
    const rounded = Math.ceil(totalFils / step) * step;
    if (rounded > amounts[amounts.length - 1]) amounts.push(rounded);
    if (amounts.length === 4) break;
  }
  return amounts;
}

/** Parses "28.5" into 2850 fils; anything that is not a non-negative amount with up to 2 decimals is null. */
export function parseMoneyInput(text: string): number | null {
  const value = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
