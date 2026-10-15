import type { RegisterSession } from "../domain.ts";
import { dubaiSupplyDate } from "../invoice-numbers.ts";

/** A register still open from an earlier Dubai business day must be closed before more sales. */
export function staleRegister(register: RegisterSession | null, now: Date): { stale: false } | { stale: true; openedOn: string } {
  if (!register || register.status !== "open") return { stale: false };
  const openedOn = dubaiSupplyDate(new Date(register.openedAt));
  return openedOn < dubaiSupplyDate(now) ? { stale: true, openedOn } : { stale: false };
}
