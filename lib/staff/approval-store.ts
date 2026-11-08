// Pending "Manager approval" requests, shown by <ApprovalHost /> (same pattern as lib/ui/confirm-store).
import type { ApprovalAction, StaffMember } from "./approval.ts";

export type ApprovalRequest = {
  id: string;
  action: ApprovalAction;
  choices: StaffMember[];
  /** The approver's member id, or null when cancelled. */
  resolve: (approverId: string | null) => void;
};

let current: ApprovalRequest | null = null;
let counter = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export function openApproval(action: ApprovalAction, choices: StaffMember[]): Promise<string | null> {
  // One approval at a time: a second request while one is open cancels the first.
  current?.resolve(null);
  return new Promise((resolve) => {
    current = { id: `approval-${++counter}`, action, choices, resolve };
    notify();
  });
}

export function answerApproval(id: string, approverId: string | null) {
  if (!current || current.id !== id) return;
  const request = current;
  current = null;
  notify();
  request.resolve(approverId);
}

export function getApproval(): ApprovalRequest | null {
  return current;
}

export function subscribeApproval(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
