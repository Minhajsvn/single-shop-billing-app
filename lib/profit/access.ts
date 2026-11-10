// Stage 2C: who sees and who changes costs on this screen (spec 2C decisions 4–5).
type Role = "owner" | "manager" | "cashier" | null;

/**
 * Cost is for an owner or manager (the person at the till) of a hosted Pro shop. Only the owner changes it, and only
 * on an owner session: the server would take a cost from a manager behind the PIN on the owner's till, so the screen
 * must not offer it.
 */
export function costAccess(input: { mode: string; hasCostFeature: boolean; sessionRole: Role; effectiveRole: Role }): { canSee: boolean; canEdit: boolean } {
  const canSee = input.mode === "hosted" && input.hasCostFeature && (input.effectiveRole === "owner" || input.effectiveRole === "manager");
  return { canSee, canEdit: canSee && input.effectiveRole === "owner" && input.sessionRole === "owner" };
}
