"use client";

import { ArrowLeft, LockSimple } from "@/components/icons";
import { BrandMark } from "@/components/brand-mark";
import { useEffect, useState } from "react";
import { useShopContext } from "@/lib/demo-store";
import type { StaffMember } from "@/lib/snapshot/types";
import { restoreOperator, setOperator } from "@/lib/staff/operator-session";
import { verifyPin } from "@/lib/staff/pin";
import { PinPad } from "./pin-pad";
import { useLockout } from "./lockout-store";

const ROLE_LABEL = { owner: "Owner", manager: "Manager", cashier: "Cashier" } as const;

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "?";
}

/** Full-screen lock: pick your name, enter your PIN (spec 2A §5.1). Shown while the PIN lock is on and nobody is unlocked. */
export function LockScreen() {
  const { staff, business } = useShopContext();
  const [chosen, setChosen] = useState<StaffMember | null>(null);
  const lockout = useLockout();
  const people = staff.filter((member) => member.status === "active");

  // A reload brings back the person who was unlocked, if they are still active with the same PIN.
  useEffect(() => {
    restoreOperator(staff);
  }, [staff]);

  async function submit(pin: string) {
    if (!chosen?.pinHash || !chosen.pinSalt) return false;
    const ok = await verifyPin(pin, chosen.pinHash, chosen.pinSalt);
    if (!ok) {
      lockout.fail(chosen.memberId);
      return false;
    }
    lockout.succeed(chosen.memberId);
    setOperator(chosen);
    return true;
  }

  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-labelledby="lock-title">
      <div className="lock-inner">
        <div className="lock-brand"><BrandMark /><span>{business?.legalName ?? "billo"}</span></div>
        {chosen ? (
          <div className="lock-pin">
            <button type="button" className="button lock-back" onClick={() => setChosen(null)}><ArrowLeft size={16} weight="bold" /> Not {chosen.displayName}?</button>
            <h1 id="lock-title" className="lock-title">{chosen.displayName}</h1>
            <p className="lock-sub">Enter your 4-digit PIN</p>
            <PinPad label={`PIN for ${chosen.displayName}`} onSubmit={submit} blockedMs={lockout.blockedMs(chosen.memberId)} />
          </div>
        ) : (
          <>
            <h1 id="lock-title" className="lock-title"><LockSimple size={22} weight="bold" /> Who is at the till?</h1>
            <ul className="lock-people">
              {people.map((member) => {
                const ready = !!member.pinHash && !!member.pinSalt;
                return (
                  <li key={member.memberId}>
                    <button type="button" className="lock-person" disabled={!ready} onClick={() => setChosen(member)}>
                      <span className="lock-avatar" aria-hidden="true">{initials(member.displayName)}</span>
                      <span className="lock-name">{member.displayName}</span>
                      <span className="lock-role">{ready ? ROLE_LABEL[member.role] : "PIN not set"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
