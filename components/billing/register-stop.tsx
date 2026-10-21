"use client";

import { LockSimple, PauseCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { ChooseTill } from "@/components/billing/choose-till";
import { CHOOSE_PLAN_HREF, UpdateCardButton, fixesInPortal } from "@/components/billing/lifecycle-banner";
import { useEntitlement } from "@/components/billing/use-entitlement";
import type { RegisterOpenDecision } from "@/lib/billing/lifecycle-view";
import { switchThisTill } from "@/lib/demo-store";

/** Shown instead of "Open register" (and the New sale screen) when this till may not start a new shift. */
export function RegisterStop({ decision }: { decision: Exclude<RegisterOpenDecision, "allow"> }) {
  const { e, role } = useEntitlement();
  const owner = role === "owner";
  const planAction = owner
    ? fixesInPortal(e) ? <UpdateCardButton className="button primary" /> : <Link className="button primary" href={CHOOSE_PLAN_HREF}>Choose a plan</Link>
    : null;

  if (decision === "choose_till") {
    return <section className="panel register-stop" aria-label="Choose which till stays"><ChooseTill /></section>;
  }

  if (decision === "till_paused") {
    return (
      <section className="panel register-stop" aria-labelledby="register-stop-title">
        <PauseCircle size={38} weight="duotone" />
        <h2 id="register-stop-title">This till is paused</h2>
        <p>Your plan allows fewer tills, so this one cannot open a new shift. Its past sales stay visible. {owner ? "Upgrade to use it again, or use the till that stays." : "Use the till that stays, or ask the shop owner to upgrade."}</p>
        <div className="register-stop-actions">
          {planAction}
          <button type="button" className="button" onClick={switchThisTill}>Use another till</button>
          <Link className="button" href="/sales">View sales and reports</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="panel register-stop" aria-labelledby="register-stop-title">
      <LockSimple size={38} weight="duotone" />
      <h2 id="register-stop-title">Your shop is read-only</h2>
      <p>The subscription has ended. You can still view, print and export everything.</p>
      {owner ? null : <p className="register-stop-ask">Ask the shop owner to renew.</p>}
      <div className="register-stop-actions">
        {planAction}
        <Link className="button" href="/sales">View sales and reports</Link>
      </div>
    </section>
  );
}
