/** One spreadsheet cell as read from .xlsx (typed) or .csv (always text). */
export type Cell = string | number | boolean | Date | null;

export type ImportField = "name" | "sku" | "barcode" | "price" | "stock" | "lowStock" | "taxCategory";

/** Which column index (0-based) holds each field; unmapped fields are absent. */
export type ColumnMapping = Partial<Record<ImportField, number>>;

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };
