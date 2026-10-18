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

/** Product ids whose stock this operation changes (stock movements, sale and refund lines). */
function referencedProducts(op: SyncOperation): string[] {
  const payload = op.payload;
  if (!payload) return [];
  if (op.entity === "stock" && "movement" in payload) return [payload.movement.productId];
  if (op.entity === "sale" && "sale" in payload) return payload.sale.lines.flatMap((line) => line.productId ? [line.productId] : []);
  if (op.entity === "credit-note" && "creditNote" in payload) return payload.creditNote.lines.flatMap((line) => line.productId ? [line.productId] : []);
  return [];
}

/**
 * Oldest first, except that a product operation moves ahead of the earliest unsynced stock movement, sale or
 * refund of that product. Product operations never change stock, so moving them earlier is safe, while
 * stock counts and sales keep their own order (a count then a sale must end at count − sale on the server).
 * After an owner fixes a refused product, the fix therefore reaches the server before its earlier opening stock.
 */
export function syncOrder(ops: SyncOperation[]): SyncOperation[] {
  const earliestNeed = new Map<string, string>();
  for (const op of ops) {
    if (op.status === "synced") continue;
    for (const productId of referencedProducts(op)) {
      const current = earliestNeed.get(productId);
      if (!current || op.createdAt < current) earliestNeed.set(productId, op.createdAt);
    }
  }
  const key = (op: SyncOperation) => {
    if (op.entity !== "product") return { at: op.createdAt, rank: 0 };
    const need = earliestNeed.get(op.entityId);
    return need && need < op.createdAt ? { at: need, rank: -1 } : { at: op.createdAt, rank: 0 };
  };
  return [...ops].sort((left, right) => {
    const a = key(left);
    const b = key(right);
    return a.at.localeCompare(b.at) || a.rank - b.rank || left.createdAt.localeCompare(right.createdAt);
  });
}

/**
 * Operations not to send yet: stock movements, sales and refunds of a product whose latest product operation was
 * refused, so the server lacks it. They go once the owner fixes the product.
 */
export function heldStockOperations(ops: SyncOperation[]): Set<string> {
  const latest = latestProductOperations(ops);
  const held = new Set<string>();
  for (const op of ops) {
    if (op.status === "synced" || op.entity === "product") continue;
    if (referencedProducts(op).some((productId) => latest.get(productId)?.status === "failed")) held.add(op.id);
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
