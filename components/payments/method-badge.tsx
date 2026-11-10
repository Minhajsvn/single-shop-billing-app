import type { PaymentMethod } from "@/lib/domain";
import { formatAED } from "@/lib/domain";
import type { Payment } from "@/lib/payments/split";

const LABEL: Record<PaymentMethod, string> = { cash: "Cash", card: "Card", transfer: "Transfer", split: "Split" };
const TONE: Record<PaymentMethod, string> = { cash: "green", card: "blue", transfer: "blue", split: "yellow" };

export function methodLabel(method: PaymentMethod): string {
  return LABEL[method] ?? "Cash";
}

/** "Cash 50.00 · Card 27.20 · Transfer 10.00 (TT-123)". */
export function paymentParts(payments: Payment[]): string {
  return payments.map((p) => `${LABEL[p.method]} ${formatAED(p.amountFils)}${p.reference ? ` (${p.reference})` : ""}`).join(" · ");
}

/** The payment column badge; a split shows its parts on hover (Stage 2B). */
export function MethodBadge({ method, payments }: { method: PaymentMethod; payments?: Payment[] }) {
  const title = method === "split" && payments?.length ? paymentParts(payments) : undefined;
  return <span className={`badge ${TONE[method] ?? "green"}`} title={title}>{methodLabel(method)}</span>;
}
