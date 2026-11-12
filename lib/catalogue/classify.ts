import type { Category, Product } from "../domain.ts";
import type { TaxCategory } from "../fiscal/countries.ts";
import { parseCostInput } from "../profit/math.ts";
import { CATEGORY_NAME_MAX } from "./categories.ts";
import { parseAmountCell, parseBarcodeCell, parsePriceCell, parseScaleCodeCell, parseTaxCategoryCell, parseTextCell, parseYesNoCell } from "./parse.ts";
import type { Cell, ColumnMapping, Parsed } from "./types.ts";

export const MAX_IMPORT_ROWS = 5000;
const NAME_MAX = 160;
const SKU_MAX = 100;
const DEFAULT_LOW_STOCK = 5;
/** Stage 2F: a new weighed product's low-stock threshold when the file gives none (1 kg). */
const DEFAULT_LOW_STOCK_GRAMS = 1000;
const ZERO_STOCK_TO_SWITCH = "Set stock to 0 before changing how this product is sold.";
const WEIGHING_IS_PRO = "Selling by weight is part of the Pro plan";

/**
 * Stage 2C: `categoryName` is the cell as typed (matched to a category ignoring case when applied; absent = leave the
 * product's category alone). `costFils` is absent when the file gives no cost or the plan has no costs.
 */
export type ProductDraft = { id: string; name: string; sku: string; barcode?: string; priceFils: number; stock: number; lowStockThreshold: number; taxCategory: TaxCategory; categoryName?: string; costFils?: number; soldByWeight?: boolean; scaleCode?: number };
export type PlannedCreate = { rowNumber: number; product: ProductDraft; possibleDuplicateOf?: string };
export type PlannedUpdate = {
  rowNumber: number;
  productId: string;
  archived: boolean;
  before: { priceFils: number; stock: number; barcode?: string };
  /** Stage 2F: soldByWeight and scaleCode are absent when the file leaves them blank (kept as they are). */
  after: { priceFils: number; stock: number; barcode?: string; categoryName?: string; costFils?: number; soldByWeight?: boolean; scaleCode?: number };
  /** The product itself changes (price, stock, barcode or category); a cost alone does not count. */
  changed: boolean;
};
export type ProblemRow = { rowNumber: number; cells: Cell[]; reasons: string[] };
/** newCategories: names to create first, each once (first spelling wins). costSkipped: the file had costs the plan cannot take. */
export type ImportPlan = { creates: PlannedCreate[]; updates: PlannedUpdate[]; problems: ProblemRow[]; newCategories: string[]; costSkipped: boolean };

type ExistingProduct = Product & { taxCategory?: TaxCategory };
const CATEGORY_PROBLEM = "Category names can be at most 40 characters.";
type ParsedRow = {
  rowNumber: number;
  cells: Cell[];
  reasons: string[];
  name: string;
  sku: string | null;
  barcode: string | null;
  priceFils: number;
  /** As written (kg for weighed products, units otherwise); converted once the product is known. */
  stock: number | null;
  lowStock: number | null;
  taxCategory: TaxCategory | null;
  categoryName: string | null;
  costFils: number | null;
  soldByWeight: boolean | null;
  scaleCode: number | null;
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
    stock: read("stock", (cell) => parseAmountCell(cell, "Stock"), null),
    lowStock: read("lowStock", (cell) => parseAmountCell(cell, "Low-stock threshold"), null),
    soldByWeight: read("soldByWeight", (cell) => parseYesNoCell(cell, "Sold by weight"), null),
    scaleCode: read("scaleCode", parseScaleCodeCell, null),
    taxCategory: read("taxCategory", parseTaxCategoryCell, null),
    categoryName: read("category", (cell) => {
      const parsed = parseTextCell(cell, CATEGORY_NAME_MAX, "Category");
      return parsed.ok ? parsed : { ok: false, reason: CATEGORY_PROBLEM };
    }, null),
    costFils: read("cost", (cell) => {
      const parsed = parseCostInput(cell === null || typeof cell === "number" ? cell : String(cell));
      return parsed.ok ? parsed : { ok: false, reason: parsed.reason };
    }, null),
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
  options: { productLimit: number | null; newId: () => string; categories?: Category[]; costAllowed?: boolean; weighingAllowed?: boolean },
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
  const scaleCounts = count(parsed.map((row) => row.scaleCode === null ? null : String(row.scaleCode)));
  for (const row of parsed) {
    if (row.barcode && barcodeCounts.get(row.barcode)! > 1) row.reasons.push("Barcode appears more than once in this file");
    if (row.sku && skuCounts.get(skuKey(row.sku))! > 1) row.reasons.push("SKU appears more than once in this file");
    if (row.scaleCode !== null && scaleCounts.get(String(row.scaleCode))! > 1) row.reasons.push("Scale code appears more than once in this file");
  }

  // Stage 2F: stock is kg for weighed products (stored as grams) and whole units for the rest.
  const weighingAllowed = options.weighingAllowed === true;
  const amounts = (row: ParsedRow, weighed: boolean): { stock: number | null; lowStock: number | null } | string => {
    const convert = (value: number | null, label: string) => {
      if (value === null) return null;
      if (weighed) return Math.round(value * 1000);
      return Number.isInteger(value) ? value : `${label} must be a whole number of 0 or more`;
    };
    const stock = convert(row.stock, "Stock");
    const lowStock = convert(row.lowStock, "Low-stock threshold");
    if (typeof stock === "string") return stock;
    if (typeof lowStock === "string") return lowStock;
    return { stock, lowStock };
  };
  const scaleHolder = (row: ParsedRow, ownId: string | null) => row.scaleCode === null ? undefined : existing.find((product) => product.id !== ownId && product.scaleCode === row.scaleCode);

  const byBarcode = new Map(existing.filter((product) => product.barcode).map((product) => [product.barcode!, product]));
  const bySku = new Map(existing.map((product) => [skuKey(product.sku), product]));
  const byName = new Map(existing.map((product) => [nameKey(product.name), product]));

  // Stage 2C: costs only on a plan that has them; category names resolve against live categories, ignoring case.
  const costAllowed = options.costAllowed === true;
  const costSkipped = !costAllowed && mapping.cost !== undefined && parsed.some((row) => row.costFils !== null);
  const liveByName = new Map((options.categories ?? []).filter((category) => !category.archived).map((category) => [category.name.trim().toLowerCase(), category]));
  const plan: ImportPlan = { creates: [], updates: [], problems: [], newCategories: [], costSkipped };
  const planned = new Set<string>();
  const categoryOf = (row: ParsedRow) => {
    if (row.categoryName === null) return {};
    const key = row.categoryName.toLowerCase();
    const existingCategory = liveByName.get(key);
    if (existingCategory) return { categoryName: existingCategory.name };
    if (!planned.has(key)) {
      planned.add(key);
      plan.newCategories.push(row.categoryName);
    }
    return { categoryName: row.categoryName };
  };
  const costOf = (row: ParsedRow) => (costAllowed && row.costFils !== null ? { costFils: row.costFils } : {});
  const pendingCreates: ParsedRow[] = [];
  const problem = (row: ParsedRow, reasons = row.reasons) => plan.problems.push({ rowNumber: row.rowNumber, cells: row.cells, reasons });

  for (const row of parsed) {
    if (row.reasons.length) {
      // Every reason at once: a stock that is not whole counts too, unless the product is sold by weight.
      const known = (row.barcode ? byBarcode.get(row.barcode) : undefined) ?? (row.sku ? bySku.get(skuKey(row.sku)) : undefined);
      const counted = amounts(row, row.soldByWeight ?? Boolean(known?.soldByWeight));
      problem(row, typeof counted === "string" ? [...row.reasons, counted] : row.reasons);
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
    const wasWeighed = Boolean(target.soldByWeight);
    if (row.soldByWeight !== null && row.soldByWeight !== wasWeighed) {
      if (row.soldByWeight && !weighingAllowed) {
        problem(row, [WEIGHING_IS_PRO]);
        continue;
      }
      if (target.stock !== 0) {
        problem(row, [ZERO_STOCK_TO_SWITCH]);
        continue;
      }
    }
    const holder = scaleHolder(row, target.id);
    if (holder) {
      problem(row, [`Scale code ${row.scaleCode} is already used by ${holder.name}.`]);
      continue;
    }
    const counted = amounts(row, row.soldByWeight ?? wasWeighed);
    if (typeof counted === "string") {
      problem(row, [counted]);
      continue;
    }
    const before = { priceFils: target.priceFils, stock: target.stock, barcode: target.barcode };
    const weighing = {
      ...(row.soldByWeight !== null ? { soldByWeight: row.soldByWeight } : {}),
      ...(row.scaleCode !== null ? { scaleCode: row.scaleCode } : {}),
    };
    const after = { priceFils: row.priceFils, stock: counted.stock ?? target.stock, barcode: target.barcode ?? row.barcode ?? undefined, ...categoryOf(row), ...costOf(row), ...weighing };
    const weighingMoves = (weighing.soldByWeight !== undefined && weighing.soldByWeight !== wasWeighed) || (weighing.scaleCode !== undefined && weighing.scaleCode !== (target.scaleCode ?? null));
    const currentCategory = target.categoryId ? (options.categories ?? []).find((category) => category.id === target.categoryId && !category.archived) : undefined;
    const categoryMoves = after.categoryName !== undefined && after.categoryName.toLowerCase() !== currentCategory?.name.trim().toLowerCase();
    plan.updates.push({
      rowNumber: row.rowNumber,
      productId: target.id,
      archived: !target.active,
      before,
      after,
      changed: before.priceFils !== after.priceFils || before.stock !== after.stock || before.barcode !== after.barcode || categoryMoves || weighingMoves,
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
    const weighed = row.soldByWeight === true;
    if (weighed && !weighingAllowed) {
      problem(row, [WEIGHING_IS_PRO]);
      continue;
    }
    const holder = scaleHolder(row, null);
    if (holder) {
      problem(row, [`Scale code ${row.scaleCode} is already used by ${holder.name}.`]);
      continue;
    }
    const counted = amounts(row, weighed);
    if (typeof counted === "string") {
      problem(row, [counted]);
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
        stock: counted.stock ?? 0,
        lowStockThreshold: counted.lowStock ?? (weighed ? DEFAULT_LOW_STOCK_GRAMS : DEFAULT_LOW_STOCK),
        taxCategory: row.taxCategory ?? "standard",
        ...categoryOf(row),
        ...costOf(row),
        ...(weighed ? { soldByWeight: true } : {}),
        ...(row.scaleCode !== null ? { scaleCode: row.scaleCode } : {}),
      },
      ...(duplicate ? { possibleDuplicateOf: duplicate.name } : {}),
    });
  }
  plan.problems.sort((left, right) => left.rowNumber - right.rowNumber);
  return { ok: true, plan };
}
