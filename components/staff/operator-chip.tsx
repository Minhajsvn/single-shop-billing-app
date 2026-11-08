"use client";

import { UserSwitch } from "@/components/icons";
import type { StaffMember } from "@/lib/snapshot/types";

const ROLE_LABEL = { owner: "Owner", manager: "Manager", cashier: "Cashier" } as const;

/** "Aisha · Cashier" and the Switch button (F9) in the top bar while the PIN lock is on. */
export function OperatorChip({ operator, onSwitch }: { operator: StaffMember; onSwitch: () => void }) {
  return (
    <span className="operator-chip">
      <span className="operator-name" title={`${operator.displayName} · ${ROLE_LABEL[operator.role]}`}>{operator.displayName} · {ROLE_LABEL[operator.role]}</span>
      <button type="button" className="button" onClick={onSwitch} title="Switch user (F9)"><UserSwitch size={15} weight="bold" /> Switch</button>
    </span>
  );
}
