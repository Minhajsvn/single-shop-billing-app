import type { Product } from "../domain.ts";

/** Exact scan match: barcode first, then SKU (case-insensitive). Never partial, never inactive. */
export function findByCode(products: Product[], code: string): Product | null {
  const value = code.trim();
  if (!value) return null;
  const active = products.filter((product) => product.active);
  return active.find((product) => product.barcode === value)
    ?? active.find((product) => product.sku.toLowerCase() === value.toLowerCase())
    ?? null;
}
