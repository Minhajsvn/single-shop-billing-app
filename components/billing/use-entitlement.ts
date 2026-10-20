"use client";

import { useEffect, useState } from "react";
import { hasFeature as entitled, type Entitlements } from "@/lib/billing/entitlements";
import { canWrite as canWriteIn, lifecycleState, registerOpenDecision, type LifecycleState, type RegisterOpenDecision, type Role } from "@/lib/billing/lifecycle-view";
import type { FeatureKey } from "@/lib/billing/plans";
import type { TillDevice } from "@/lib/snapshot/types";
import { useDemoStore, useShopContext } from "@/lib/demo-store";

export const READ_ONLY_REASON = "Read-only — sales and edits are paused.";

/** The sample shop and an unconfigured build have no subscription: everything built is usable, nothing is gated. */
const SAMPLE_ENTITLEMENTS: Entitlements = {
  planId: null, status: null, access: "full", trialEndsAt: null, graceEndsAt: null,
  accessEndsAt: null, cancelAt: null, hasPaymentMethod: false, billingInterval: null, currentPeriodEnd: null, features: [],
  limits: { branches: null, tills: null, members: null, products: null },
};

/** The device clock, re-read every minute so an access end passing while the page is open takes effect. */
function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export type EntitlementView = {
  e: Entitlements;
  stale: boolean;
  state: LifecycleState;
  now: Date;
  /** The signed-in member's role; an unknown role gets the cashier's view (no billing buttons). */
  role: Role;
  registerOpen: boolean;
  hasFeature(key: FeatureKey): boolean;
  /** False only in read-only with no register open on this browser (never mid-shift). */
  canWrite: boolean;
};

export function useEntitlement(): EntitlementView {
  const { mode, entitlements, entitlementsStale, role } = useShopContext();
  const store = useDemoStore();
  const now = useNow();
  const hosted = mode === "hosted";
  const e = hosted ? entitlements : SAMPLE_ENTITLEMENTS;
  const state = lifecycleState(e, now);
  const registerOpen = store.register?.status === "open";
  return {
    e,
    stale: hosted && entitlementsStale,
    state,
    now,
    role: hosted ? role ?? "cashier" : "owner",
    registerOpen,
    hasFeature: (key) => entitled(e, key),
    canWrite: canWriteIn(state, registerOpen),
  };
}

/** What happens when this browser tries to open the register now ("allow" whenever a register is already open). */
export function useRegisterDecision(): RegisterOpenDecision {
  const { mode, device, devices } = useShopContext();
  const { e, stale, now, registerOpen } = useEntitlement();
  if (mode !== "hosted") return "allow";
  return registerOpenDecision({
    e, stale, device, registerOpen, now,
    activeTills: devices.filter((item) => item.status === "active").length,
  });
}

/** The same decision at the moment of the click: the clock may have crossed the access end since the last render. */
export function registerDecisionNow(view: EntitlementView, context: { mode: string; device: TillDevice | null; devices: TillDevice[] }): RegisterOpenDecision {
  if (context.mode !== "hosted") return "allow";
  return registerOpenDecision({
    e: view.e, stale: view.stale, device: context.device, registerOpen: view.registerOpen, now: new Date(),
    activeTills: context.devices.filter((item) => item.status === "active").length,
  });
}
