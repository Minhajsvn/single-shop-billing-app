// Which till actions need a manager's PIN, and who may give it (spec 2A §5.4).
import type { MemberRole, StaffMember } from "../snapshot/types.ts";

export type { StaffMember };

export type ApprovalAction =
  | { kind: "refund" }
  | { kind: "remove-line" }
  | { kind: "lower-quantity" }
  | { kind: "register-open" }
  | { kind: "register-close" }
  | { kind: "discount"; discountFils: number; listTotalFils: number };

/** Managers and the owner never need approval. A cashier's discount needs it only when strictly above the set percentage. */
export function needsApproval(action: ApprovalAction, operatorRole: MemberRole, managerDiscountPct: number): boolean {
  if (operatorRole !== "cashier") return false;
  if (action.kind !== "discount") return true;
  if (action.discountFils <= 0) return false;
  return action.discountFils * 100 > managerDiscountPct * action.listTotalFils;
}

/** People who can approve for this operator: active managers and the owner who have a PIN, never the operator. */
export function approverChoices(staff: StaffMember[], operatorId: string): StaffMember[] {
  return staff.filter((m) => m.memberId !== operatorId && m.status === "active" && (m.role === "manager" || m.role === "owner") && !!m.pinHash && !!m.pinSalt);
}
