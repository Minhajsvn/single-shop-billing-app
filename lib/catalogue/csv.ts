import type { Product } from "../domain.ts";
import type { TaxCategory } from "../fiscal/countries.ts";
import type { ProblemRow } from "./classify.ts";
import { EXPORT_HEADINGS } from "./columns.ts";
import type { Cell } from "./types.ts";

const BOM = "﻿";

/** RFC 4180 reader: every cell is text. Strips a BOM, accepts CRLF or LF, quoted commas/newlines and "" escapes. */
export function parseCsv(text: string): Cell[][] {
  const source = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: Cell[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function csvField(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV with a BOM (so Excel reads Arabic as UTF-8) and CRLF line endings. */
export function toCsv(rows: (string | number)[][]): string {
  return BOM + rows.map((row) => row.map(csvField).join(",") + "\r\n").join("");
}

const TAX_LABEL: Record<TaxCategory, string> = { standard: "Standard", zero: "Zero-rated", exempt: "Exempt" };

function formatFils(fils: number): string {
  return `${Math.floor(fils / 100)}.${String(fils % 100).padStart(2, "0")}`;
}

/** Catalogue export in the import's own layout. Barcodes are written ="digits" so Excel keeps them as text. */
export function productsToCsv(products: (Product & { taxCategory?: TaxCategory })[]): string {
  return toCsv([
    [...EXPORT_HEADINGS],
    ...products.map((product) => [
      product.name,
      product.sku,
      product.barcode ? `="${product.barcode}"` : "",
      formatFils(product.priceFils),
      product.stock,
      product.lowStockThreshold,
      TAX_LABEL[product.taxCategory ?? "standard"],
      product.active ? "Active" : "Archived",
    ]),
  ]);
}

/** The rows the import skipped, in their original columns, plus why — to fix in Excel and import again. */
export function problemsToCsv(headings: Cell[], problems: ProblemRow[]): string {
  const text = (cell: Cell) => cell === null || cell === undefined ? "" : cell instanceof Date ? cell.toISOString() : String(cell);
  return toCsv([
    [...headings.map(text), "Problem"],
    ...problems.map((problem) => [...headings.map((_, index) => text(problem.cells[index] ?? null)), problem.reasons.join("; ")]),
  ]);
}
