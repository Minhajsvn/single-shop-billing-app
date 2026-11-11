import type { TaxCategory } from "../fiscal/countries.ts";
import { isValidEan13 } from "./barcode.ts";
import type { Cell, Parsed } from "./types.ts";

const BARCODE_MAX = 100;

function text(cell: Cell): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return cell.toISOString();
  return String(cell).trim();
}

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const problem = <T>(reason: string): Parsed<T> => ({ ok: false, reason });

/** VAT-inclusive selling price in fils. Text is read by regex only; a numeric cell may carry float noise below 1e-6. */
export function parsePriceCell(cell: Cell): Parsed<number> {
  const invalid = problem<number>("Price must be an amount above 0 with at most 2 decimals, e.g. 12.50");
  if (typeof cell === "number") {
    if (!Number.isFinite(cell) || cell <= 0) return invalid;
    const fils = Math.round(cell * 100);
    return Math.abs(cell * 100 - fils) < 1e-6 && fils > 0 ? ok(fils) : invalid;
  }
  const raw = text(cell).replace(/^AED\s*/i, "").replace(/\s*AED$/i, "");
  // Thousands separators only in full groups ("1,234.50"); "12,50" is ambiguous and refused.
  if (!/^\d{1,3}(,\d{3})+(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(raw)) return invalid;
  const [whole, decimals = ""] = raw.replace(/,/g, "").split(".");
  const fils = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  return fils > 0 ? ok(fils) : invalid;
}

function parseWholeCell(cell: Cell, label: string): Parsed<number | null> {
  const invalid = problem<number | null>(`${label} must be a whole number of 0 or more`);
  if (typeof cell === "number") return Number.isInteger(cell) && cell >= 0 ? ok(cell) : invalid;
  const raw = text(cell);
  if (!raw) return ok(null);
  return /^\d+(\.0+)?$/.test(raw) ? ok(Number(raw.split(".")[0])) : invalid;
}

/**
 * Stage 2F: a stock or low-stock amount with up to 3 decimals (kg for weighed products, whole units otherwise; the
 * caller decides which once it knows the product). Null means the cell was blank.
 */
export function parseAmountCell(cell: Cell, label: string): Parsed<number | null> {
  const invalid = problem<number | null>(`${label} must be a whole number of 0 or more`);
  const thousandths = (value: number) => Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6;
  if (typeof cell === "number") return Number.isFinite(cell) && cell >= 0 && thousandths(cell) ? ok(cell) : invalid;
  const raw = text(cell);
  if (!raw) return ok(null);
  return /^\d+(\.\d+)?$/.test(raw) && thousandths(Number(raw)) ? ok(Number(raw)) : invalid;
}

/** Stage 2F: yes/no; null when blank. */
export function parseYesNoCell(cell: Cell, label: string): Parsed<boolean | null> {
  if (typeof cell === "boolean") return ok(cell);
  const raw = text(cell).toLowerCase();
  if (!raw) return ok(null);
  if (["yes", "y", "true", "1"].includes(raw)) return ok(true);
  if (["no", "n", "false", "0"].includes(raw)) return ok(false);
  return problem(`${label} must be yes or no`);
}

/** Stage 2F: a scale code, 1–999999; null when blank. */
export function parseScaleCodeCell(cell: Cell): Parsed<number | null> {
  const raw = typeof cell === "number" ? String(cell) : text(cell).replace(/^="(.*)"$/, "$1").trim();
  if (!raw) return ok(null);
  const value = /^\d{1,6}$/.test(raw) ? Number(raw) : 0;
  return value >= 1 ? ok(value) : problem("Scale code must be a whole number from 1 to 999999");
}

/** Stock count; null means the cell was blank. */
export function parseStockCell(cell: Cell): Parsed<number | null> {
  return parseWholeCell(cell, "Stock");
}

export function parseThresholdCell(cell: Cell): Parsed<number | null> {
  return parseWholeCell(cell, "Low-stock threshold");
}

/**
 * Barcode as exact text. Excel stores barcodes typed as numbers, which loses a leading zero: a 12-digit numeric cell
 * is restored to "0…" only when that makes a valid EAN-13. The export writes ="digits" so Excel keeps text.
 */
export function parseBarcodeCell(cell: Cell): Parsed<string | null> {
  if (typeof cell === "number") {
    if (!Number.isSafeInteger(cell) || cell < 0) return problem("Barcode must be whole digits; format the column as text in Excel");
    const digits = String(cell);
    return ok(digits.length === 12 && isValidEan13(`0${digits}`) ? `0${digits}` : digits);
  }
  let raw = text(cell);
  const wrapped = /^="(.*)"$/.exec(raw);
  if (wrapped) raw = wrapped[1].trim();
  if (!raw) return ok(null);
  if (/^\d+(\.\d+)?e[+-]?\d+$/i.test(raw)) return problem("Barcode was shortened by Excel (e.g. 6.29E+12); format the column as text and re-enter it");
  if (raw.length > BARCODE_MAX) return problem(`Barcode is longer than ${BARCODE_MAX} characters`);
  return ok(raw);
}

const TAX_WORDS: Record<string, TaxCategory> = {
  standard: "standard", "standard rated": "standard", "standard-rated": "standard", std: "standard", sr: "standard", "5%": "standard", "5": "standard",
  zero: "zero", "zero rated": "zero", "zero-rated": "zero", zr: "zero", "0%": "zero", "0": "zero",
  exempt: "exempt", ex: "exempt",
};

/** VAT category from clear words only; null means blank (the caller defaults to standard). */
export function parseTaxCategoryCell(cell: Cell): Parsed<TaxCategory | null> {
  const raw = text(cell).toLowerCase().replace(/\s+/g, " ");
  if (!raw) return ok(null);
  const category = TAX_WORDS[raw];
  return category ? ok(category) : problem("VAT category must be Standard, Zero-rated or Exempt");
}

/** Trimmed text; null when blank. Over-long names are a problem, never truncated. */
export function parseTextCell(cell: Cell, max: number, label = "Name"): Parsed<string | null> {
  // The export writes number-like SKUs as ="00123" so Excel keeps them as text.
  const raw = text(cell).replace(/^="(.*)"$/, "$1").trim();
  if (!raw) return ok(null);
  return raw.length > max ? problem(`${label} is longer than ${max} characters`) : ok(raw);
}
