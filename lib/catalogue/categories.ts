import type { Category, Product, SyncOperation } from "../domain.ts";
import { rejectionText } from "../sync/rejections.ts";

export const CATEGORY_NAME_MAX = 40;
export const UNCATEGORISED = "Uncategorised";

/** Why a category name cannot be used, or null when it can. Live names are unique ignoring case (spec 2C §4.1). */
export function validCategoryName(name: string, existing: Category[], selfId?: string): string | null {
  const clean = name.trim();
  if (!clean) return "Enter a category name.";
  if (clean.length > CATEGORY_NAME_MAX) return `Use at most ${CATEGORY_NAME_MAX} characters.`;
  const key = clean.toLowerCase();
  if (existing.some((category) => !category.archived && category.id !== selfId && category.name.trim().toLowerCase() === key)) {
    return "A category with this name already exists";
  }
  return null;
}

/** Live categories in the owner's order (sortOrder, then name). */
export function liveCategories(categories: Category[]): Category[] {
  return categories.filter((category) => !category.archived).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/** The name shown for a product's category; a missing or archived one reads "Uncategorised". */
export function categoryName(categories: Category[], categoryId: string | null | undefined): string {
  const category = categoryId ? categories.find((item) => item.id === categoryId) : undefined;
  return category && !category.archived ? category.name : UNCATEGORISED;
}

/** Saved state from before Stage 2C has no categories. */
export function normalizeCategories(value: unknown): Category[] {
  return Array.isArray(value) ? (value as Category[]) : [];
}

/** Categories the server refused (their latest operation failed), with the reason in the owner's words. */
export function categorySyncProblems(ops: SyncOperation[]): Map<string, string> {
  const latest = new Map<string, SyncOperation>();
  for (const op of ops) {
    if (op.entity !== "category") continue;
    const current = latest.get(op.entityId);
    if (!current || current.createdAt < op.createdAt) latest.set(op.entityId, op);
  }
  const problems = new Map<string, string>();
  for (const [id, op] of latest) if (op.status === "failed") problems.set(id, rejectionText(op.error ?? "The hosted service rejected this category."));
  return problems;
}

/** A new category operation carries the whole category, so earlier unsent ones for it are dropped. */
export function supersedeCategoryOperations(ops: SyncOperation[], categoryId: string): SyncOperation[] {
  return ops.filter((op) => op.entity !== "category" || op.entityId !== categoryId || op.status === "synced");
}

/**
 * The till's product grid: active products in the chosen category ("all" for every one). A search looks across all
 * categories, so a typed name or a scan is never hidden by the chip.
 */
export function filterByCategory(products: Product[], categoryId: string | "all", query: string): Product[] {
  const term = query.trim().toLowerCase();
  if (term) return products.filter((product) => product.active && [product.name, product.sku, product.barcode].some((value) => value?.toLowerCase().includes(term)));
  return products.filter((product) => product.active && (categoryId === "all" || product.categoryId === categoryId));
}
