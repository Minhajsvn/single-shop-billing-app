"use client";

import { useSyncExternalStore } from "react";
import { useShopContext } from "@/lib/demo-store";
import type { MemberRole, StaffMember } from "@/lib/snapshot/types";
import { getOperator, subscribeOperator } from "@/lib/staff/operator-session";

export function useOperator(): StaffMember | null {
  return useSyncExternalStore(subscribeOperator, getOperator, () => null);
}

/**
 * The role pages and actions follow. With the PIN lock on it is the person behind the PIN (spec 2A §5.2);
 * otherwise the signed-in member's role, as before 2A.
 */
export function useEffectiveRole(): MemberRole | null {
  const { role, pinLock } = useShopContext();
  const operator = useOperator();
  return pinLock && operator ? operator.role : role;
}
