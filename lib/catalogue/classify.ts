import type { Product } from "../domain.ts";
import type { TaxCategory } from "../fiscal/countries.ts";
import { parseBarcodeCell, parsePriceCell, parseStockCell, parseTaxCategoryCell, parseTextCell, parseThresholdCell } from "./parse.ts";
import type { Cell, ColumnMapping, Parsed } from "./types.ts";

export const MAX_IMPORT_ROWS = 5000;
const NAME_MAX = 160;
const SKU_MAX = 100;
const DEFAULT_LOW_STOCK = 5;

export type ProductDraft = { id: string; name: string; sku: string; barcode?: string; priceFils: number; stock: number; lowStockThreshold: number; taxCategory: TaxCategory };
export type PlannedCreate = { rowNumber: number; product: ProductDraft; possibleDuplicateOf?: string };
export type PlannedUpdate = {
  rowNumber: number;
  productId: string;
  archived: boolean;
  before: { priceFils: number; stock: number; barcode?: string };
  after: { priceFils: number; stock: number; barcode?: string };
  changed: boolean;
};
export type ProblemRow = { rowNumber: number; cells: Cell[]; reasons: string[] };
export type ImportPlan = { creates: PlannedCreate[]; updates: PlannedUpdate[]; problems: ProblemRow[] };

type ExistingProduct = Product & { taxCategory?: TaxCategory };
type ParsedRow = {
  rowNumber: number;
  cells: Cell[];
  reasons: string[];
  name: string;
  sku: string | null;
  barcode: string | null;
  priceFils: number;
  stock: number | null;
  lowStock: number | null;
  taxCategory: TaxCategory | null;
};

const skuKey = (sku: string) => sku.trim().toLowerCase();
const nameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");
const isBlank = (cell: Cell) => cell === null || cell === undefined || String(cell).trim() === "";

/** Next free generated SKUs (P-0001, P-0002…), continuing after the highest P- number and skipping any taken SKU. */
export function nextGeneratedSkus(existingSkus: Iterable<string>, count: number): string[] {
  const taken = new Set<string>();
  let highest = 0;
  for (const sku of existingSkus) {
    taken.add(skuKey(sku));
    const match = /^p-(\d+)$/i.exec(sku.trim());
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  const result: string[] = [];
  for (let next = highest + 1; result.length < count; next++) {
    const sku = `P-${String(next).padStart(4, "0")}`;
    if (!taken.has(skuKey(sku))) result.push(sku);
  }
  return result;
}

function parseRow(cells: Cell[], rowNumber: number, mapping: ColumnMapping): ParsedRow {
  const reasons: string[] = [];
  const read = <T>(field: keyof ColumnMapping, parse: (cell: Cell) => Parsed<T>, blank: T): T => {
    const index = mapping[field];
    if (index === undefined) return blank;
    const parsed = parse(cells[index] ?? null);
    if (!parsed.ok) {
      reasons.push(parsed.reason);
      return blank;
    }
    return parsed.value;
  };
  const name = read("name", (cell) => parseTextCell(cell, NAME_MAX), null);
  if (name === null && !reasons.length) reasons.push("Name is missing");
  return {
    rowNumber,
    cells,
    reasons,
    name: name ?? "",
    sku: read("sku", (cell) => parseTextCell(cell, SKU_MAX, "SKU"), null),
    barcode: read("barcode", parseBarcodeCell, null),
    priceFils: read("price", parsePriceCell, 0),
    stock: read("stock", parseStockCell, null),
    lowStock: read("lowStock", parseThresholdCell, null),
    taxCategory: read("taxCategory", parseTaxCategoryCell, null),
  };
}

/**
 * Sorts spreadsheet rows (rows[0] = headings) into creates, updates and problems against the current catalogue.
 * Matching is barcode first, then SKU (owner decision). Updates change price and stock (a count) and may add a barcode.
 */
export function planImport(
  rows: Cell[][],
  mapping: ColumnMapping,
  existing: ExistingProduct[],
  options: { productLimit: number | null; newId: () => string },
): { ok: true; plan: ImportPlan } | { ok: false; error: string } {
  if (mapping.name === undefined || mapping.price === undefined) return { ok: false, error: "Choose which column holds the product name and the price." };
  const dataRows = rows.slice(1);
  if (dataRows.length > MAX_IMPORT_ROWS) {
    return { ok: false, error: `This file has ${dataRows.length.toLocaleString("en-US")} rows; split it into files of at most ${MAX_IMPORT_ROWS.toLocaleString("en-US")}.` };
  }

  const parsed = dataRows
    .map((cells, index) => ({ cells, rowNumber: index + 2 }))
    .filter(({ cells }) => !cells.every(isBlank))
    .map(({ cells, rowNumber }) => parseRow(cells, rowNumber, mapping));

  const count = (values: (string | null)[]) => values.reduce((map, value) => value ? map.set(value, (map.get(value) ?? 0) + 1) : map, new Map<string, number>());
  const barcodeCounts = count(parsed.map((row) => row.barcode));
  const skuCounts = count(parsed.map((row) => row.sku && skuKey(row.sku)));
  for (const row of parsed) {
    if (row.barcode && barcodeCounts.get(row.barcode)! > 1) row.reasons.push("Barcode appears more than once in this file");
    if (row.sku && skuCounts.get(skuKey(row.sku))! > 1) row.reasons.push("SKU appears more than once in this file");
  }

  const byBarcode = new Map(existing.filter((product) => product.barcode).map((product) => [product.barcode!, product]));
  const bySku = new Map(existing.map((product) => [skuKey(product.sku), product]));
  const byName = new Map(existing.map((product) => [nameKey(product.name), product]));

  const plan: ImportPlan = { creates: [], updates: [], problems: [] };
  const pendingCreates: ParsedRow[] = [];
  const problem = (row: ParsedRow, reasons = row.reasons) => plan.problems.push({ rowNumber: row.rowNumber, cells: row.cells, reasons });

  for (const row of parsed) {
    if (row.reasons.length) {
      problem(row);
      continue;
    }
    const byCode = row.barcode ? byBarcode.get(row.barcode) : undefined;
    const bySkuMatch = row.sku ? bySku.get(skuKey(row.sku)) : undefined;
    if (byCode && bySkuMatch && byCode.id !== bySkuMatch.id) {
      problem(row, ["Barcode and SKU belong to two different products"]);
      continue;
    }
    const target = byCode ?? bySkuMatch;
    if (!target) {
      pendingCreates.push(row);
      continue;
    }
    if (!byCode && row.barcode && target.barcode && target.barcode !== row.barcode) {
      problem(row, [`This SKU's product already has barcode ${target.barcode}`]);
      continue;
    }
    const before = { priceFils: target.priceFils, stock: target.stock, barcode: target.barcode };
    const after = { priceFils: row.priceFils, stock: row.stock ?? target.stock, barcode: target.barcode ?? row.barcode ?? undefined };
    plan.updates.push({
      rowNumber: row.rowNumber,
      productId: target.id,
      archived: !target.active,
      before,
      after,
      changed: before.priceFils !== after.priceFils || before.stock !== after.stock || before.barcode !== after.barcode,
    });
  }

  const generated = nextGeneratedSkus(
    [...existing.map((product) => product.sku), ...parsed.flatMap((row) => row.sku ? [row.sku] : [])],
    pendingCreates.filter((row) => !row.sku).length,
  );
  let active = existing.filter((product) => product.active).length;
  for (const row of pendingCreates) {
    if (options.productLimit !== null && active >= options.productLimit) {
      problem(row, [`Over your plan's limit of ${options.productLimit} products: upgrade to Pro`]);
      continue;
    }
    active += 1;
    const duplicate = byName.get(nameKey(row.name));
    plan.creates.push({
      rowNumber: row.rowNumber,
      product: {
        id: options.newId(),
        name: row.name,
        sku: row.sku ?? generated.shift()!,
        ...(row.barcode ? { barcode: row.barcode } : {}),
        priceFils: row.priceFils,
        stock: row.stock ?? 0,
        lowStockThreshold: row.lowStock ?? DEFAULT_LOW_STOCK,
        taxCategory: row.taxCategory ?? "standard",
      },
      ...(duplicate ? { possibleDuplicateOf: duplicate.name } : {}),
    });
  }
  plan.problems.sort((left, right) => left.rowNumber - right.rowNumber);
  return { ok: true, plan };
}
