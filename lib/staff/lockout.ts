// Wrong-PIN lockout, kept per till: five wrong tries block that person for five minutes; a right PIN clears it.

export const MAX_PIN_FAILURES = 5;
export const PIN_BLOCK_MS = 5 * 60_000;

export type LockoutState = Record<string, { fails: number; blockedUntil: number | null }>;

export function recordFailure(state: LockoutState, memberId: string, now: number): LockoutState {
  const fails = (state[memberId]?.fails ?? 0) + 1;
  if (fails >= MAX_PIN_FAILURES) return { ...state, [memberId]: { fails: 0, blockedUntil: now + PIN_BLOCK_MS } };
  return { ...state, [memberId]: { fails, blockedUntil: state[memberId]?.blockedUntil ?? null } };
}

export function recordSuccess(state: LockoutState, memberId: string): LockoutState {
  const next = { ...state };
  delete next[memberId];
  return next;
}

/** Milliseconds this person must still wait; 0 when they may try. */
export function blockedFor(state: LockoutState, memberId: string, now: number): number {
  const until = state[memberId]?.blockedUntil;
  return until && until > now ? until - now : 0;
}
