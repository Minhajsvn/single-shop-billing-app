import type { Product, SyncOperation } from "../domain.ts";
import type { TaxCategory } from "../fiscal/countries.ts";
import { rejectionText } from "../sync/rejections.ts";

/** Products saved before Stage 1D have no VAT category; they are standard-rated. */
export function withTaxCategories(products: (Omit<Product, "taxCategory"> & { taxCategory?: TaxCategory })[]): Product[] {
  return products.map((product) => ({ ...product, taxCategory: product.taxCategory ?? "standard" }));
}

/**
 * Strictly increasing createdAt (base + i ms) in queue order. The outbox syncs oldest first, so a product
 * operation queued before its opening stock reaches the server first even when both are made in the same tick.
 */
export function stampSequence<T extends { createdAt: string }>(ops: T[], base: Date): T[] {
  return ops.map((op, index) => ({ ...op, createdAt: new Date(base.getTime() + index).toISOString() }));
}

/** The newest product operation per product id. */
function latestProductOperations(ops: SyncOperation[]): Map<string, SyncOperation> {
  const latest = new Map<string, SyncOperation>();
  for (const op of ops) {
    if (op.entity !== "product") continue;
    const current = latest.get(op.entityId);
    if (!current || current.createdAt < op.createdAt) latest.set(op.entityId, op);
  }
  return latest;
}

/** Stock operations not to send yet: their product's latest product operation was rejected, so the server lacks it. */
export function heldStockOperations(ops: SyncOperation[]): Set<string> {
  const latest = latestProductOperations(ops);
  const held = new Set<string>();
  for (const op of ops) {
    if (op.entity !== "stock" || op.status === "synced" || !op.payload || !("movement" in op.payload)) continue;
    if (latest.get(op.payload.movement.productId)?.status === "failed") held.add(op.id);
  }
  return held;
}

/** Products the server refused, with the reason in the owner's words. */
export function productSyncProblems(ops: SyncOperation[]): Map<string, string> {
  const problems = new Map<string, string>();
  for (const [productId, op] of latestProductOperations(ops)) {
    if (op.status === "failed") problems.set(productId, rejectionText(op.error ?? "The hosted service rejected this product."));
  }
  return problems;
}

/** A new product operation carries the whole product, so earlier unsent ones for it are dropped. */
export function supersedeProductOperations(ops: SyncOperation[], productId: string): SyncOperation[] {
  return ops.filter((op) => op.entity !== "product" || op.entityId !== productId || op.status === "synced");
}
