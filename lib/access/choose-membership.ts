import type { MemberRole } from "../snapshot/types.ts";

export type MembershipRow = { business_id: string; role: MemberRole | string; status: string; created_at?: string | null };

const RANK: Record<string, number> = { owner: 3, manager: 2, cashier: 1 };

/**
 * The one shop a user works in when they belong to several (for example a cashier who once made a trial shop of
 * their own and was later added to the owner's shop). Deterministic: highest role first, then the oldest membership,
 * then the business id. Inactive memberships are never chosen.
 */
export function chooseMembership<T extends MembershipRow>(rows: readonly T[] | null | undefined): T | null {
  let best: T | null = null;
  for (const row of rows ?? []) {
    if (row.status !== "active") continue;
    if (!best || compare(row, best) < 0) best = row;
  }
  return best;
}

function compare(a: MembershipRow, b: MembershipRow) {
  const byRole = (RANK[b.role] ?? 0) - (RANK[a.role] ?? 0);
  if (byRole) return byRole;
  const aTime = a.created_at ? Date.parse(a.created_at) : Number.POSITIVE_INFINITY;
  const bTime = b.created_at ? Date.parse(b.created_at) : Number.POSITIVE_INFINITY;
  if (aTime !== bTime) return aTime < bTime ? -1 : 1;
  return a.business_id < b.business_id ? -1 : a.business_id > b.business_id ? 1 : 0;
}
