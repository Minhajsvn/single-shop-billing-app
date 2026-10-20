export type BillingMembership = { business_id: string; role: string; status: string };

export type GuardFailure = { status: 401 | 403; error: string };

/** Billing actions are for the active shop owner only. Returns null when allowed. */
export function ownerGuard(user: { id: string } | null, membership: BillingMembership | null): GuardFailure | null {
  if (!user) return { status: 401, error: "Authentication is required." };
  if (!membership || membership.status !== "active" || membership.role !== "owner") {
    return { status: 403, error: "Only the shop owner can manage billing." };
  }
  return null;
}
