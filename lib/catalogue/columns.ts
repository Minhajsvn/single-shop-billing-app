import type { Cell, ColumnMapping, ImportField } from "./types.ts";

/** Export column order; every heading is one the import recognises (Status is ignored on import). */
export const EXPORT_HEADINGS = ["Name", "SKU", "Barcode", "Price (AED)", "Stock", "Low-stock threshold", "VAT category", "Status"] as const;

function normalise(heading: Cell): string {
  return String(heading ?? "").toLowerCase().replace(/[^\p{L}\p{N}%]+/gu, " ").trim();
}

// Checked in this order; each field takes the first column that matches, and each column feeds one field.
const RULES: { field: ImportField; exact?: string[]; test?: (heading: string) => boolean }[] = [
  { field: "sku", exact: ["sku", "code", "item code", "product code"] },
  { field: "barcode", exact: ["barcode", "bar code", "ean", "upc", "gtin"], test: (h) => h.includes("باركود") },
  { field: "name", exact: ["name", "item", "product", "description", "item name", "product name"], test: (h) => h.includes("اسم") },
  { field: "price", exact: ["price", "selling price", "price aed", "retail price", "sale price", "unit price"], test: (h) => h.includes("سعر") },
  { field: "stock", exact: ["stock", "qty", "quantity", "on hand", "stock qty"], test: (h) => h.includes("كمية") },
  { field: "lowStock", test: (h) => h.includes("low stock") || h.includes("reorder") },
  { field: "taxCategory", test: (h) => h.startsWith("vat") || h.startsWith("tax") },
];

/** Best guess at which column holds which field, from the heading row. The owner can change any of it. */
export function guessMapping(headings: readonly Cell[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  for (const rule of RULES) {
    const index = headings.findIndex((heading, column) => {
      if (used.has(column)) return false;
      const h = normalise(heading);
      return Boolean(h) && (Boolean(rule.exact?.includes(h)) || Boolean(rule.test?.(h)));
    });
    if (index !== -1) {
      mapping[rule.field] = index;
      used.add(index);
    }
  }
  return mapping;
}
