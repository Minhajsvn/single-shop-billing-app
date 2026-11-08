"use client";

import { X } from "@/components/icons";
import { useState, useSyncExternalStore } from "react";
import { useShopContext } from "@/lib/demo-store";
import type { ApprovalAction } from "@/lib/staff/approval";
import { approverChoices, needsApproval } from "@/lib/staff/approval";
import { answerApproval, getApproval, openApproval, subscribeApproval } from "@/lib/staff/approval-store";
import { verifyPin } from "@/lib/staff/pin";
import type { StaffMember } from "@/lib/snapshot/types";
import { PinPad } from "./pin-pad";
import { useLockout } from "./lockout-store";
import { useOperator } from "./use-operator";

const WHAT: Record<ApprovalAction["kind"], string> = {
  refund: "This refund needs a manager.",
  "remove-line": "Removing an item needs a manager.",
  "lower-quantity": "Lowering a quantity needs a manager.",
  "register-open": "Opening the register needs a manager.",
  "register-close": "Closing the register needs a manager.",
  discount: "This discount is above the limit and needs a manager.",
};

/**
 * Ask for a manager when the person behind the PIN is a cashier (spec 2A §5.4).
 * Resolves undefined when no approval is needed, null when cancelled, or the approver's member id.
 */
export function useApproval() {
  const { pinLock, lockSettings, staff } = useShopContext();
  const operator = useOperator();
  return async (action: ApprovalAction): Promise<string | null | undefined> => {
    if (!pinLock || !operator) return undefined;
    if (!needsApproval(action, operator.role, lockSettings.managerDiscountPct)) return undefined;
    return openApproval(action, approverChoices(staff, operator.memberId));
  };
}

const getNone = () => null;

/** Renders the open approval request, if any. Mounted once in the app shell. */
export function ApprovalHost() {
  const request = useSyncExternalStore(subscribeApproval, getApproval, getNone);
  if (!request) return null;
  return <ApprovalDialog key={request.id} id={request.id} action={request.action} choices={request.choices} />;
}

function ApprovalDialog({ id, action, choices }: { id: string; action: ApprovalAction; choices: StaffMember[] }) {
  const [chosen, setChosen] = useState<StaffMember | null>(choices.length === 1 ? choices[0]! : null);
  const lockout = useLockout();
  const cancel = () => answerApproval(id, null);

  async function submit(pin: string) {
    if (!chosen?.pinHash || !chosen.pinSalt) return false;
    if (!(await verifyPin(pin, chosen.pinHash, chosen.pinSalt))) {
      lockout.fail(chosen.memberId);
      return false;
    }
    lockout.succeed(chosen.memberId);
    answerApproval(id, chosen.memberId);
    return true;
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) cancel(); }} onKeyDown={(event) => { if (event.key === "Escape") cancel(); }}>
      <div className="modal approval-dialog" role="dialog" aria-modal="true" aria-labelledby="approval-title">
        <div className="modal-header">
          <div><div className="panel-title" id="approval-title">Manager approval</div><div className="panel-subtitle">{WHAT[action.kind]}</div></div>
          <button type="button" className="button icon-only" onClick={cancel} aria-label="Cancel"><X size={16} weight="bold" /></button>
        </div>
        <div className="modal-body">
          {choices.length === 0 ? (
            <p className="approval-empty">No manager has a PIN yet. Ask the owner to set one in Settings, Staff.</p>
          ) : (
            <div className="approval-people" role="radiogroup" aria-label="Approving manager">
              {choices.map((member) => (
                <button key={member.memberId} type="button" role="radio" aria-checked={chosen?.memberId === member.memberId}
                  className={`button ${chosen?.memberId === member.memberId ? "primary" : ""}`} onClick={() => setChosen(member)}>
                  {member.displayName}
                </button>
              ))}
            </div>
          )}
          {chosen ? <PinPad label={`PIN for ${chosen.displayName}`} onSubmit={submit} blockedMs={lockout.blockedMs(chosen.memberId)} /> : null}
        </div>
        <div className="modal-footer"><button type="button" className="button" onClick={cancel}>Cancel</button></div>
      </div>
    </div>
  );
}
