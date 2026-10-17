import { withTaxCategories } from "./product-sync.ts";
import { READ_ONLY_ENTITLEMENTS, type Entitlements } from "../billing/entitlements.ts";
import type { DemoState } from "../domain.ts";
import type { BusinessProfile, TillDevice } from "../snapshot/types.ts";

export type EntitlementCache = { entitlements: Entitlements; expiresAt: string };

export type HostedContext = {
  business: BusinessProfile | null;
  devices: TillDevice[];
  entitlementCache: EntitlementCache | null;
  lastRefreshedAt: string | null;
};

export type HostedCache = { version: 1; state: DemoState; context: HostedContext };

/** Each signed-in user gets their own cache, so one account never sees or overwrites another's unsynced work. */
export function hostedCacheKey(userId: string): string {
  return `shop-ledger-hosted-store-v1:${userId}`;
}

/** Splits work into batches no larger than `size` (the sync API accepts at most 50 operations per request). */
export function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}

export function emptyShopState(): DemoState {
  return { products: [], stockMovements: [], sales: [], customers: [], creditNotes: [], syncOperations: [], register: null };
}

export function emptyHostedContext(): HostedContext {
  return { business: null, devices: [], entitlementCache: null, lastRefreshedAt: null };
}

/** Cached entitlements are trusted until their signed expiry; after that the shop is read-only until it reconnects. */
export function effectiveEntitlements(cache: EntitlementCache | null, now = new Date()): Entitlements {
  if (!cache) return READ_ONLY_ENTITLEMENTS;
  const expiresAt = new Date(cache.expiresAt).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return READ_ONLY_ENTITLEMENTS;
  return cache.entitlements;
}

export function parseHostedCache(raw: string | null): HostedCache | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<HostedCache>;
    if (value?.version !== 1 || !value.state || !value.context || !Array.isArray(value.state.sales)) return null;
    // Products cached before Stage 1D have no VAT category.
    return { ...value, state: { ...value.state, products: withTaxCategories(value.state.products ?? []) } } as HostedCache;
  } catch {
    return null;
  }
}

/** Runs async tasks strictly one after another; a failed task does not block the ones queued behind it. */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function run<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task, task);
    tail = result.catch(() => undefined);
    return result;
  };
}

/** Counts completed syncs so a snapshot requested before a sync finished can be recognised and discarded. */
export function createSyncEpoch() {
  let value = 0;
  return {
    current: () => value,
    bump: () => { value += 1; },
    isStale: (startedAt: number) => startedAt !== value,
  };
}
