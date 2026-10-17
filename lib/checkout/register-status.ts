import type { RegisterSession } from "../domain.ts";
import { dubaiSupplyDate } from "../invoice-numbers.ts";

/** A register still open from an earlier Dubai business day must be closed before more sales. */
export function staleRegister(register: RegisterSession | null, now: Date): { stale: false } | { stale: true; openedOn: string } {
  if (!register || register.status !== "open") return { stale: false };
  const openedOn = dubaiSupplyDate(new Date(register.openedAt));
  return openedOn < dubaiSupplyDate(now) ? { stale: true, openedOn } : { stale: false };
}

/** Why a sale cannot be completed right now, or null. Checked at completion time, not only at render. */
export function saleBlockReason(register: RegisterSession | null, now: Date): string | null {
  if (!register || register.status !== "open") return "Open the register before completing a sale.";
  const stale = staleRegister(register, now);
  return stale.stale ? `Close the register opened on ${stale.openedOn} before selling.` : null;
}
