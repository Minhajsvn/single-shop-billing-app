// Stage 2E: tills pick up promotion (and other shop) changes by refreshing the snapshot every 5 minutes while online.
export const SNAPSHOT_REFRESH_MS = 5 * 60 * 1000;

export function shouldRefresh(lastAt: number, now: number): boolean {
  return now - lastAt >= SNAPSHOT_REFRESH_MS;
}
