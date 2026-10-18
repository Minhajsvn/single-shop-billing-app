/**
 * Pending changes sync on their own only once the shop has finished loading: while AuthGate is still loading,
 * the IndexedDB copy of the outbox may yet replace the localStorage one and undo a sync's results.
 */
export function shouldAutoSync(input: { ready: boolean; online: boolean; pending: number }): boolean {
  return input.ready && input.online && input.pending > 0;
}
