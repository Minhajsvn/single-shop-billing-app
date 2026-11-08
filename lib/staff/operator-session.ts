// The person currently behind the PIN on this till (spec 2A §5.2). Held in memory and in this tab's session
// storage (member id and PIN hash only), never synced on its own. A reload restores them only if they are still
// active with the same PIN; a disabled person or a reset PIN sends the till back to the lock screen.
import type { StaffMember } from "../snapshot/types.ts";

export const OPERATOR_STORAGE_KEY = "billo.operator";

type SessionStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

let current: StaffMember | null = null;
const listeners = new Set<() => void>();

function defaultStore(): SessionStore | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function emit() {
  listeners.forEach((listener) => listener());
}

export function getOperator(): StaffMember | null {
  return current;
}

export function subscribeOperator(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setOperator(member: StaffMember | null, store: SessionStore | null = defaultStore()): void {
  current = member;
  try {
    if (member) store?.setItem(OPERATOR_STORAGE_KEY, JSON.stringify({ memberId: member.memberId, pinHash: member.pinHash }));
    else store?.removeItem(OPERATOR_STORAGE_KEY);
  } catch {
    // Storage blocked: the operator still holds for this page; a reload shows the lock screen.
  }
  emit();
}

function stillValid(staff: StaffMember[], memberId: string, pinHash: string | null): StaffMember | null {
  const member = staff.find((m) => m.memberId === memberId);
  return member && member.status === "active" && !!member.pinHash && member.pinHash === pinHash ? member : null;
}

/** After a reload: the stored person, only if still active with the same PIN. */
export function restoreOperator(staff: StaffMember[], store: SessionStore | null = defaultStore()): StaffMember | null {
  let saved: { memberId?: unknown; pinHash?: unknown } | null = null;
  try {
    const raw = store?.getItem(OPERATOR_STORAGE_KEY);
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    saved = null;
  }
  const member = saved && typeof saved.memberId === "string" && typeof saved.pinHash === "string" ? stillValid(staff, saved.memberId, saved.pinHash) : null;
  setOperator(member, store);
  return member;
}

/** A new staff list arrived (snapshot): drop the operator if disabled or their PIN changed; pick up name or role changes. */
export function reconcileOperator(staff: StaffMember[], store: SessionStore | null = defaultStore()): void {
  if (!current) return;
  const member = stillValid(staff, current.memberId, current.pinHash);
  if (!member) setOperator(null, store);
  else if (member.role !== current.role || member.displayName !== current.displayName) setOperator(member, store);
}

/** The ids a record carries: the operator, and the approving manager when there was one. Empty with no operator. */
export function actorFields(operator: StaffMember | null, approvedByMemberId?: string): { operatorMemberId?: string; approvedByMemberId?: string } {
  if (!operator) return {};
  return approvedByMemberId ? { operatorMemberId: operator.memberId, approvedByMemberId } : { operatorMemberId: operator.memberId };
}
