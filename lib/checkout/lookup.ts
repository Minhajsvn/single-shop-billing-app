import type { Product } from "../domain.ts";

/** The same retail code written the other way: a 12-digit UPC-A is the EAN-13 "0" + UPC-A. */
function alternateCode(value: string): string | null {
  if (/^\d{12}$/.test(value)) return `0${value}`;
  if (/^0\d{12}$/.test(value)) return value.slice(1);
  return null;
}

/**
 * Exact scan match: barcode first (also as UPC-A/EAN-13 with or without the leading 0, since scanners and
 * spreadsheets disagree on it), then SKU (case-insensitive). Never partial, never inactive.
 */
export function findByCode(products: Product[], code: string): Product | null {
  const value = code.trim();
  if (!value) return null;
  const active = products.filter((product) => product.active);
  const alternate = alternateCode(value);
  return active.find((product) => product.barcode === value)
    ?? (alternate ? active.find((product) => product.barcode === alternate) : undefined)
    ?? active.find((product) => product.sku.toLowerCase() === value.toLowerCase())
    ?? null;
}
