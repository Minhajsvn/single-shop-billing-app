// Stage 2B payment maths: one row per method on a sale or refund (spec 2026-11-09-stage-2b §4–5). Pure.

export type PayMethod = "cash" | "card" | "transfer";
export type Payment = { id: string; method: PayMethod; amountFils: number; reference?: string };
export type SplitDraft = Partial<Record<PayMethod, number>>;

export const PAY_METHODS: PayMethod[] = ["cash", "card", "transfer"];
export const REFERENCE_MAX = 60;

const used = (draft: SplitDraft) => PAY_METHODS.filter((method) => (draft[method] ?? 0) > 0);
const sumOf = (draft: SplitDraft) => PAY_METHODS.reduce((sum, method) => sum + Math.max(0, draft[method] ?? 0), 0);

/** The document's payment rows, or one row from its single method (records made before 2B). */
export function paymentsOf(doc: { id: string; paymentMethod: string; grossFils: number; payments?: Payment[] }): Payment[] {
  if (doc.payments?.length) return doc.payments;
  const method = PAY_METHODS.includes(doc.paymentMethod as PayMethod) ? (doc.paymentMethod as PayMethod) : "cash";
  return [{ id: `${doc.id}-${method}`, method, amountFils: doc.grossFils }];
}

/** One row: that method. Two or more: "split". */
export function summaryMethod(payments: Payment[]): PayMethod | "split" {
  return payments.length === 1 ? payments[0]!.method : "split";
}

/**
 * What is left to pay and the change on the cash part. ok only when nothing is left, nothing is over, every used line
 * is above zero and, when cash received is given, it covers the cash part.
 */
export function splitSummary(totalFils: number, draft: SplitDraft, cashReceivedFils: number | null): { leftFils: number; changeFils: number | null; ok: boolean; error?: string } {
  const negative = PAY_METHODS.some((method) => (draft[method] ?? 0) < 0 || !Number.isInteger(draft[method] ?? 0));
  const leftFils = totalFils - sumOf(draft);
  const cashPart = draft.cash ?? 0;
  const changeFils = cashReceivedFils === null ? null : cashReceivedFils - cashPart;
  if (negative) return { leftFils, changeFils, ok: false, error: "Amounts must be whole fils and not below zero." };
  if (leftFils > 0) return { leftFils, changeFils, ok: false, error: "There is still something left to pay." };
  if (leftFils < 0) return { leftFils, changeFils, ok: false, error: "The parts add up to more than the total." };
  if (used(draft).length === 0) return { leftFils, changeFils, ok: false, error: "Enter at least one amount." };
  if (cashPart > 0 && cashReceivedFils !== null && cashReceivedFils < cashPart) return { leftFils, changeFils, ok: false, error: "Cash received must cover the cash part." };
  return { leftFils, changeFils, ok: true };
}

/** Put whatever the other lines leave on `method`. Unchanged when nothing is left. */
export function restOn(totalFils: number, draft: SplitDraft, method: PayMethod): SplitDraft {
  const others = PAY_METHODS.filter((item) => item !== method).reduce((sum, item) => sum + Math.max(0, draft[item] ?? 0), 0);
  const rest = totalFils - others;
  return rest > 0 ? { ...draft, [method]: rest } : draft;
}

/** The rows to save: empty lines dropped, the reference trimmed to 60 and kept only on transfer. */
export function toPayments(draft: SplitDraft, reference: string | undefined, newId: () => string): Payment[] {
  const ref = reference?.trim().slice(0, REFERENCE_MAX) || undefined;
  return used(draft).map((method) => ({ id: newId(), method, amountFils: draft[method]!, ...(method === "transfer" && ref ? { reference: ref } : {}) }));
}

export function methodTotals(payments: Payment[]): Record<PayMethod, number> {
  const totals: Record<PayMethod, number> = { cash: 0, card: 0, transfer: 0 };
  for (const payment of payments) totals[payment.method] += payment.amountFils;
  return totals;
}

/** Splitting one sale or refund across methods is Pro (split_payment). */
export function canSplit(features: readonly string[]): boolean {
  return features.includes("split_payment");
}
