"use client";

import { Sparkle, WarningCircle } from "@/components/icons";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEntitlement } from "@/components/billing/use-entitlement";
import { useOnline } from "@/components/offline-runtime";
import { useShopContext } from "@/lib/demo-store";

/**
 * Stage 2D: Purchases needs a hosted Pro shop and a connection (nothing is kept on the device). Page access by role is
 * handled by the app shell (owner and manager); the server checks every call again.
 */
export function PurchasingGate({ children, offlineText = "Purchases need a connection" }: { children: ReactNode; offlineText?: string }) {
  const { mode } = useShopContext();
  const { hasFeature } = useEntitlement();
  const online = useOnline();
  if (mode !== "hosted") {
    return <section className="panel locked-card" role="note"><div className="panel-body"><Sparkle size={20} weight="bold" /><div><div className="panel-title">Purchases work in your own shop</div><p className="field-hint">Sign in to a billo shop to record supplier deliveries.</p></div></div></section>;
  }
  if (!hasFeature("purchasing")) {
    return <section className="panel locked-card" role="note"><div className="panel-body"><Sparkle size={20} weight="bold" /><div><div className="panel-title">Record supplier deliveries and keep costs up to date on Pro</div><p className="field-hint">Each delivery adds stock and updates the product&apos;s average cost, so profit stays right. <Link href="/settings?tab=billing">See plans</Link>.</p></div></div></section>;
  }
  if (!online) return <div className="notice" role="status"><WarningCircle size={18} weight="fill" /><span>{offlineText}</span></div>;
  return <>{children}</>;
}
