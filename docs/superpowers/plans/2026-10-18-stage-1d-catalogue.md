# Stage 1D Catalogue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners import their Excel or CSV product list safely. They can then edit, archive, export and label products, and store a VAT category. Every product change syncs to the server.

**Architecture:**
- **Pure logic in `lib/catalogue/`**, unit-tested with the Node runner: parsing, column matching, row classification, CSV, and barcode encoding.
- **A new `"product"` outbox operation**, applied by a new `apply_product_sync` RPC.
- **Import stock as an absolute count:** a new `import_count` movement type that the server turns into a difference.
- **UI** in the Inventory page, plus dedicated dialogs under `components/catalogue/`.

**Tech Stack:**
- Next.js 16 and React 19 (`useSyncExternalStore` store in `lib/demo-store.ts`)
- Supabase Postgres (plpgsql RPCs, RLS)
- zod 4
- Node 24 test runner
- one new dependency: `read-excel-file` for `.xlsx`

**Spec:** `docs/superpowers/specs/2026-10-18-stage-1d-catalogue-design.md`. It is the binding authority; read §2 (owner decisions) and §11 (designer calls) before Task 1.

## Global Constraints

- **Next.js:** follow `AGENTS.md`. This version differs from training data, so read `node_modules/next/dist/docs/` before using any framework API.
- **Money:** integer fils. Text is parsed with string and regex, never `parseFloat`. A numeric Excel cell is rounded to 2 decimals; more precision than that is a problem row.
- **Imports in pure modules:** `lib/catalogue/*` and any other module under test use relative imports with a `.ts` extension, never `@/`, so the Node test runner can load them.
- **Tests:** `node --experimental-strip-types --test tests/*.test.mjs` (`npm test`).
- **Migrations:**
  - add new files only; never edit applied ones
  - every redefined RPC re-applies `alter function … set search_path = public, extensions, pg_temp`
  - SQL tests are appended to `supabase/tests/foundation_test.sql`
  - verify with `supabase db reset`, `npm run test:sql` and `npm run test:rehearsal`
  - **never push to hosted Supabase**
- **ESLint (React compiler):** no synchronous setState in effects (use `setTimeout`), no ref access during render.
- **Layout:** at 375px width there is no horizontal page scroll, and touch targets are 44px.
- **Dependencies:**
  - Add only `read-excel-file`, pinned to an exact version at least 2 weeks old (`npm view read-excel-file time`).
  - Barcode encoding is written in-house; no barcode library.
  - Never the npm `xlsx` package.
- **Limits:** 5,000 data rows per file. Starter allows 5,000 products, and Pro and above have no limit.
- **Matching, from the spec §2:** barcode first, then SKU. If they point to two different products, the row is a Problem. On a match, update price and stock (and set a barcode the product lacked).
- **Stock on an import update:** it **replaces** the current stock, as a count.
- **VAT category is stored only.** Checkout, invoices and reports stay at 5%.
- **Fixed copy:**
  - the import movement reason is `Spreadsheet import`
  - the over-limit problem reads `Over your plan's limit of N products: upgrade to Pro`
  - the unsynced flag reads `Not saved to the server`
  - next to the VAT select: `Checkout currently charges 5% VAT on every product.`

## Review Focus

These failure modes are the ones no unit test exercises. Each is pinned in the smoke test (Task 11) or a named test.

1. **A real Excel file**:
   - barcodes stored as numbers
   - a 12-digit numeric cell that was an EAN-13 with a leading zero
   - an exported file re-saved by Excel, in both `.csv` and `.xlsx`, re-imports with no changes (Task 11, checks 2–3)
2. **A thermal label print**: one label per page at 50×25mm, and the printed SKU barcode added to the cart by a scan (Task 11, check 8).
3. **A 5,000-row file**: the page stays responsive through parse, preview and confirm, and the outbox drains to 0 (Task 11, check 4).
4. **An offline import followed by a reconnect and a snapshot refresh**: no imported product disappears, none is duplicated, and stock is correct (Task 6 `snapshot-merge` test, plus Task 11, check 5).
5. **Two tills**: the other till sells before the import syncs, and the server ends at the counted stock (Task 5, SQL section 20).

---

## File map

| Path | Responsibility |
|---|---|
| `lib/catalogue/types.ts` | `Cell`, `ImportField`, `ColumnMapping`, `ImportPlan` and the related types |
| `lib/catalogue/parse.ts` | Cell parsers for price, stock, threshold, barcode and VAT category |
| `lib/catalogue/columns.ts` | Heading-to-field guessing, export headings |
| `lib/catalogue/classify.ts` | `planImport`, `nextGeneratedSkus` |
| `lib/catalogue/csv.ts` | `parseCsv`, `toCsv`, `productsToCsv`, `problemsToCsv` |
| `lib/catalogue/barcode.ts` | EAN-13 and Code 128B module encoding, `barcodeFor` |
| `lib/sync/rejections.ts` | Turn server rejection codes into the owner-facing text |
| `lib/store/product-sync.ts` | Pure outbox helpers: ordering, held stock operations, product sync problems |
| `supabase/migrations/202610180019_import_count_enum.sql` | Add the `import_count` enum value (kept on its own) |
| `supabase/migrations/202610180020_catalogue_sync.sql` | Barcode index fix, `apply_product_sync`, redefined `apply_stock_sync` |
| `supabase/migrations/202610180021_*.sql` | Plan catalogue with Starter at 5,000, generated by `npm run plans:sql` |
| `components/catalogue/import-dialog.tsx` | Three-step import UI |
| `components/catalogue/product-form.tsx` | Shared Add and Edit form |
| `components/catalogue/label-print-dialog.tsx`, `label-sheet.tsx` | Label quantity and size choice, and the printable labels |
| Modified | `lib/domain.ts`, `lib/demo-store.ts`, `lib/snapshot/{types,map-rows,merge}.ts`, `lib/sync/request-schema.ts`, `app/api/v1/sync/route.ts`, `app/api/v1/snapshot/route.ts`, `lib/store/hosted.ts`, `lib/offline-db.ts`, `lib/billing/plans.ts`, `lib/print.ts`, `components/inventory-workspace.tsx`, `hooks/use-demo-products.ts`, `app/globals.css`, `tests/plans.test.mjs` |

---

### Task 1: Cell parsers and column guessing

**Files:**
- Create: `lib/catalogue/types.ts`, `lib/catalogue/parse.ts`, `lib/catalogue/columns.ts`, `lib/catalogue/barcode.ts` (only `isValidEan13` for now)
- Test: `tests/catalogue-parse.test.mjs`

**Interfaces:**
- Consumes: `TaxCategory` from `lib/fiscal/countries.ts`.
- Produces:
  - `type Cell = string | number | boolean | Date | null`
  - `type ImportField = "name" | "sku" | "barcode" | "price" | "stock" | "lowStock" | "taxCategory"`
  - `type ColumnMapping = Partial<Record<ImportField, number>>` (column index)
  - `type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string }`
  - `parsePriceCell(cell: Cell): Parsed<number>`: fils, always > 0
  - `parseStockCell(cell: Cell): Parsed<number | null>`: `null` means the cell was blank
  - `parseThresholdCell(cell: Cell): Parsed<number | null>`
  - `parseBarcodeCell(cell: Cell): Parsed<string | null>`
  - `parseTaxCategoryCell(cell: Cell): Parsed<TaxCategory | null>`
  - `parseTextCell(cell: Cell, max: number): Parsed<string | null>`
  - `guessMapping(headings: Cell[]): ColumnMapping`
  - `EXPORT_HEADINGS: readonly string[]`, in this order: `Name, SKU, Barcode, Price (AED), Stock, Low-stock threshold, VAT category, Status`

- [ ] **Step 1: Write the failing tests** in `tests/catalogue-parse.test.mjs`:

```js
test("price accepts plain, AED-labelled, thousands and numeric cells", () => {
  for (const [cell, fils] of [["12", 1200], ["12.5", 1250], ["AED 12.50", 1250], ["12.50 AED", 1250], ["1,234.50", 123450], [12.5, 1250], [28.499999999, 2850]])
    assert.deepEqual(parsePriceCell(cell), { ok: true, value: fils });
});
test("price rejects ambiguous, over-precise, zero, negative and text", () => {
  for (const cell of ["12,50", "12.505", "0", "-3", "AED twelve", "—", "", null, 12.345, 0])
    assert.equal(parsePriceCell(cell).ok, false);
});
test("stock is a whole number ≥ 0 or blank", () => {
  assert.deepEqual(parseStockCell(40), { ok: true, value: 40 });
  assert.deepEqual(parseStockCell("40.0"), { ok: true, value: 40 });
  assert.deepEqual(parseStockCell(""), { ok: true, value: null });
  for (const cell of [4.5, "-1", "lots"]) assert.equal(parseStockCell(cell).ok, false);
});
test("numeric barcode cells become exact digits; a 12-digit cell that is an EAN-13 with a lost leading 0 is restored", () => {
  assert.deepEqual(parseBarcodeCell(6291100211014), { ok: true, value: "6291100211014" });
  assert.deepEqual(parseBarcodeCell(" 0012345 "), { ok: true, value: "0012345" });
  assert.deepEqual(parseBarcodeCell(12345678905), { ok: true, value: "12345678905" }); // 11 digits: unchanged
  assert.deepEqual(parseBarcodeCell(735000000001), { ok: true, value: "0735000000001" }); // 12 digits, "0…" is a valid EAN-13
  assert.deepEqual(parseBarcodeCell(735000000000), { ok: true, value: "735000000000" });  // padding gives an invalid EAN-13: unchanged
  assert.deepEqual(parseBarcodeCell("735000000001"), { ok: true, value: "735000000001" }); // text cells are never padded
});
```

Further tests:

```js
test("export-style ="digits" barcode cells are unwrapped", () => {
  assert.deepEqual(parseBarcodeCell('="6291100211014"'), { ok: true, value: "6291100211014" });
});
test("barcode longer than 100 characters is a problem; exponent text is a problem", () => {
  assert.equal(parseBarcodeCell("9".repeat(101)).ok, false);
  assert.equal(parseBarcodeCell("6.29E+12").ok, false);
});
test("VAT category reads clear words only", () => {
  for (const [cell, v] of [["Standard", "standard"], ["5%", "standard"], ["zero-rated", "zero"], ["0%", "zero"], ["Exempt", "exempt"], ["", null]])
    assert.deepEqual(parseTaxCategoryCell(cell), { ok: true, value: v });
  assert.equal(parseTaxCategoryCell("maybe").ok, false);
});
test("guessMapping recognises English and Arabic headings and export headings", () => {
  assert.deepEqual(guessMapping(["Item Name", "Barcode", "Selling Price", "Qty"]), { name: 0, barcode: 1, price: 2, stock: 3 });
  assert.deepEqual(guessMapping(["اسم", "باركود", "سعر", "كمية"]), { name: 0, barcode: 1, price: 2, stock: 3 });
  assert.deepEqual(guessMapping(EXPORT_HEADINGS), { name: 0, sku: 1, barcode: 2, price: 3, stock: 4, lowStock: 5, taxCategory: 6 });
});
```

**Implementer note:** the barcode-restore rule is: a **numeric** cell with exactly 12 digits is padded to `"0" + digits` only when the result is a valid EAN-13. Put `isValidEan13` in `lib/catalogue/barcode.ts` now; Task 4 extends that file.

- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/catalogue-parse.test.mjs`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** the parsers and `guessMapping`.
  - Price regex on the text with the `AED` prefix or suffix and spaces removed: `^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$`.
  - A numeric cell is accepted when `Math.abs(cell * 100 - Math.round(cell * 100)) < 1e-6`.
  - Headings are matched case- and space-insensitively against the synonym lists in spec §7.2. Arabic matching is by `includes`.
  - "Status" maps to nothing, so it is ignored.
  - Text cells reject over-long values with the reason `Name is longer than 160 characters`.

- [ ] **Step 4: Run** the same command. Expected: PASS.

- [ ] **Step 5: Commit** with `feat(catalogue): cell parsers and column guessing for import`.

### Task 2: Row classification (`planImport`)

**Files:**
- Create: `lib/catalogue/classify.ts`
- Test: `tests/catalogue-classify.test.mjs`

**Interfaces:**
- Consumes: Task 1 parsers and types, and `Product` from `lib/domain.ts`. Task 6 adds `taxCategory` to `Product`; until then, read it as optional and treat a missing value as `"standard"`.
- Produces:
  - `type ProductDraft = { id: string; name: string; sku: string; barcode?: string; priceFils: number; stock: number; lowStockThreshold: number; taxCategory: TaxCategory }`
  - `type PlannedCreate = { rowNumber: number; product: ProductDraft; possibleDuplicateOf?: string /* existing product name */ }`
  - `type PlannedUpdate = { rowNumber: number; productId: string; archived: boolean; before: { priceFils: number; stock: number; barcode?: string }; after: { priceFils: number; stock: number; barcode?: string }; changed: boolean }`
  - `type ProblemRow = { rowNumber: number; cells: Cell[]; reasons: string[] }`
  - `type ImportPlan = { creates: PlannedCreate[]; updates: PlannedUpdate[]; problems: ProblemRow[] }`
  - `planImport(rows: Cell[][], mapping: ColumnMapping, existing: Product[], options: { productLimit: number | null; newId: () => string }): { ok: true; plan: ImportPlan } | { ok: false; error: string }`
    - `rows[0]` holds the headings. `rowNumber` is the 1-based spreadsheet row.
    - Wholly blank rows are skipped.
  - `nextGeneratedSkus(existingSkus: Iterable<string>, count: number): string[]`
  - `MAX_IMPORT_ROWS = 5000`

- [ ] **Step 1: Write the failing tests.** Build each case with a small `existing` list:

```js
test("refuses a file with more than 5,000 data rows, or with no name or price column", () => { /* ok:false with messages "This file has 5,001 rows; split it into files of at most 5,000." and "Choose which column holds the product name and the price." */ });
test("barcode match updates price and replaces stock; unchanged values give changed:false", () => {});
test("no barcode but SKU match (case-insensitive) updates; an incoming barcode is added when no other product has it", () => {});
test("barcode → product A and SKU → product B is a problem 'Barcode and SKU belong to two different products'", () => {});
test("blank stock on an update keeps current stock; blank stock on a create is 0", () => {});
test("several blank-barcode rows all become creates", () => {});
test("repeated barcode within the file flags every copy 'Barcode appears more than once in this file'; repeated SKU likewise", () => {});
test("unmatched row whose name equals an existing name (ignoring case/spacing) is a create with possibleDuplicateOf", () => {});
test("generated SKUs continue after the highest P- number and skip SKUs in the file", () => {
  assert.deepEqual(nextGeneratedSkus(["P-0007", "p-0002", "ABC"], 2), ["P-0008", "P-0009"]);
});
test("plan limit: 4,990 active + 20 creates with limit 5,000 → 10 creates, 10 problems with the over-limit text", () => {});
test("an archived product matched by barcode is an update with archived:true and does not count toward the limit", () => {});
test("round trip: planImport(parseCsv(productsToCsv(products))) has 0 creates, 0 problems, every update changed:false", () => { /* add after Task 3 lands; mark test.todo until then */ });
```

Write real assertions in each body using the exact strings below. The over-limit text is `Over your plan's limit of 5000 products: upgrade to Pro`. The new-product low-stock threshold default is 5.

- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/catalogue-classify.test.mjs`. Expected: FAIL.

- [ ] **Step 3: Implement `planImport`.**
  1. Validate the mapping and the row count.
  2. Parse every row into cells or reasons.
  3. Collect repeats of barcode and SKU within the file.
  4. Match against `existing`: barcode first, then SKU.
  5. Generate SKUs for unmatched rows that have none, using one `nextGeneratedSkus` call sized to the number of unmatched rows. Pass it the existing SKUs plus every SKU in the file.
  6. Apply the limit to creates in file order. The count is the active products in `existing` plus creates already accepted.

  Problem reasons are plain sentences, joined in the UI.

- [ ] **Step 4: Run** the same command. Expected: PASS, with the round-trip test still `todo`.

- [ ] **Step 5: Commit** with `feat(catalogue): classify import rows into creates, updates and problems`.

### Task 3: CSV read and write; export layout

**Files:**
- Create: `lib/catalogue/csv.ts`
- Test: `tests/catalogue-csv.test.mjs`; also turn the round-trip `todo` in `tests/catalogue-classify.test.mjs` into a real test

**Interfaces:**
- Consumes: `EXPORT_HEADINGS` (Task 1), `planImport` (Task 2).
- Produces:
  - `parseCsv(text: string): Cell[][]`: RFC 4180; strips a leading BOM; handles CRLF and LF, quoted commas and newlines, and `""` escapes. Every cell is a string.
  - `toCsv(rows: (string | number)[][]): string`: BOM, then CRLF line endings; quotes fields as needed.
  - `productsToCsv(products: Product[]): string`: uses `EXPORT_HEADINGS`.
    - The barcode is written as `="<digits>"` so Excel keeps it as text.
    - Price is written as `12.50`.
    - VAT category is written as `Standard` / `Zero-rated` / `Exempt`.
    - Status is written as `Active` / `Archived`.
  - `problemsToCsv(headings: Cell[], problems: ProblemRow[]): string`: the original columns plus a final `Problem` column.

- [ ] **Step 1: Write the failing tests.**
  - `parseCsv` of `'﻿Name,Price\r\n"Tea, green",12.50\n"Say ""hi""",3'` gives `[["Name","Price"],["Tea, green","12.50"],['Say "hi"',"3"]]`.
  - `toCsv` output starts with `﻿` and uses `\r\n`.
  - `productsToCsv` of one product with barcode `6291100211014` contains `"=""6291100211014"""` (the quoted form of `="6291100211014"`).
  - An Arabic name survives `parseCsv(productsToCsv(...))` unchanged.
  - Enable the round-trip test from Task 2 with three products: one with a barcode, one without, one archived.

- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/catalogue-csv.test.mjs tests/catalogue-classify.test.mjs`. Expected: FAIL.

- [ ] **Step 3: Implement** the CSV functions.

- [ ] **Step 4: Run** the same command. Expected: PASS, including the round trip.

- [ ] **Step 5: Commit** with `feat(catalogue): CSV import/export with Excel-safe barcodes`.

### Task 4: Barcode encoding

**Files:**
- Modify: `lib/catalogue/barcode.ts`
- Test: `tests/catalogue-barcode.test.mjs`

**Interfaces:**
- Produces:
  - `isValidEan13(code: string): boolean`
  - `ean13Modules(code: string): string`: exactly 95 characters of `0`/`1`
  - `code128Modules(text: string): string`: Code 128 set B, characters 32–126 only; throws `RangeError` for anything else
  - `barcodeFor(product: { barcode?: string; sku: string }): { symbology: "ean13" | "code128"; value: string; modules: string }`
    - EAN-13 when the barcode is 13 digits and valid.
    - Otherwise Code 128 of the barcode.
    - With no barcode, Code 128 of the SKU.

- [ ] **Step 1: Write the failing tests.**
  - `isValidEan13("4006381333931")` is true.
  - `isValidEan13("6291100211014")` is false; its check digit should be 2.
  - `ean13Modules("4006381333931")`:
    - has length 95
    - starts with `101`
    - has `01010` at index 45
    - ends with `101`
    - first left digit `0` with parity L for leading digit `4` is `0001101`, at index 3 to 9
  - `code128Modules("ABC")`:
    - has length 68
    - starts with `11010010000` (Start B)
    - ends with `1100011101011` (Stop)
    - has check symbol value 1, pattern `11001101100`, at index 44 to 54
  - `code128Modules("é")` throws.
  - `barcodeFor({ sku: "P-0001" })` gives `{ symbology: "code128", value: "P-0001" }`.
  - `barcodeFor({ barcode: "4006381333931", sku: "X" })` gives `symbology: "ean13"`.

- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/catalogue-barcode.test.mjs`. Expected: FAIL.

- [ ] **Step 3: Implement** the encoders: the standard EAN-13 L/G/R tables with the first-digit parity table, and the 107-pattern Code 128 table.

- [ ] **Step 4: Run** the same command. Expected: PASS.

- [ ] **Step 5: Commit** with `feat(catalogue): EAN-13 and Code 128 barcode encoding`.

### Task 5: Database (barcode uniqueness, product sync, import count, Starter 5,000)

**Files:**
- Create: `supabase/migrations/202610180019_import_count_enum.sql`, `supabase/migrations/202610180020_catalogue_sync.sql`, and the generated `supabase/migrations/202610180021_*.sql`
- Modify: `lib/billing/plans.ts` (Starter `products: 5000`), `tests/plans.test.mjs`, `supabase/tests/foundation_test.sql` (sections 18–22)

**Interfaces:**
- **`apply_product_sync(p_operation_id uuid, p_business_id uuid, p_entity_id uuid, p_payload jsonb) returns jsonb`.** Same signature, ownership check, `sync_operations` idempotency and grants as `apply_stock_sync` in `202610130016`.
  - Payload: `{ product: { id, name, sku, barcode?, priceFils, lowStockThreshold, active, taxCategory }, deviceId? }`.
  - Upserts by id. It never writes `stock_quantity` (a new row starts at 0).
  - Raises `P0001` with message `product_id_mismatch`, `product_belongs_to_another_business`, `product_sku_taken` or `product_barcode_taken`. The last two come from catching `unique_violation` and reading `CONSTRAINT_NAME`.
  - Lets `plan_limit_reached` pass through unchanged.
- **Barcode uniqueness:**
  - drop the table constraint created by `unique nulls not distinct (business_id, barcode)`; look its name up in `pg_constraint` (expected `products_business_id_barcode_key`)
  - create `unique index products_business_barcode_unique on public.products (business_id, barcode) where barcode is not null`
- **`apply_stock_sync`:** copy the latest body verbatim from `202610130016` and change only these things:
  - Movement type `'import-count'` maps to `'import_count'`.
  - For `import_count`:
    - require `p_payload->>'countedStock'` to be an integer ≥ 0, otherwise `import_count_requires_counted_stock`
    - resolve the product by `movement.productId`; it must exist, otherwise `hosted_product_not_found`
    - `select … for update`
    - delta := counted − current
    - if delta = 0, record the `sync_operations` row and return `accepted` with no movement
    - otherwise set `stock_quantity = counted` and insert a movement with `quantity_delta = delta`
  - The product payload becomes optional. When it is null, the product is resolved by `movement_payload->>'productId'`. Creating a product from the payload stays available only for `opening` movements that do carry one, which keeps already-queued old operations working.
- **Plan catalogue:** `npm run plans:sql -- --write 202610180021` generates the upsert from `lib/billing/plans.ts`.

- [ ] **Step 1: Write the failing SQL tests**, as sections 18–22 in `supabase/tests/foundation_test.sql`, following the style of existing sections.
  - **18.** Two products with a null barcode in one business both insert. A duplicate non-null barcode still raises `unique_violation`.
  - **19. `apply_product_sync`:**
    - it creates a product with stock 0
    - a second operation updates name, price and `tax_category='zero'` and leaves `stock_quantity` alone
    - re-sending the same `p_operation_id` is a no-op
    - another product's SKU gives `product_sku_taken`, and its barcode gives `product_barcode_taken`
    - an id that belongs to another business gives `product_belongs_to_another_business`
  - **20. Import count with another till's sale:**
    - stock is 10; a 3-unit sale is applied through `apply_sale_sync`, giving 7
    - `import-count` with `countedStock` 40 gives stock 40 and a movement with `quantity_delta = 33`, type `import_count`
    - a second count of 40 writes no movement
  - **21.** At Starter with the active-product limit lowered to 1 inside the test transaction (`update plan_catalog set max_products = 1 where id = 'starter'`), a second product through `apply_product_sync` raises `plan_limit_reached`.
  - **22.** A `receipt` movement with no `product` in the payload, for an existing product, succeeds.

  Also update `tests/plans.test.mjs` so Starter has `products: 5000`.

- [ ] **Step 2: Run the tests and watch them fail.**
  - Start Docker and local Supabase as in the 1C ledger. Run `supabase db reset`, then `npm run test:sql`. Expected: FAIL at section 18.
  - Run `npm test`. Expected: FAIL in `plans.test.mjs`.

- [ ] **Step 3: Write the three migrations and change Starter to 5000** in `lib/billing/plans.ts`. Keep the enum migration on its own, because a new enum value cannot be used in the same transaction that adds it.

- [ ] **Step 4: Run** `supabase db reset`, `npm run test:sql`, `npm run test:rehearsal` and `npm test`. Expected: all PASS.

- [ ] **Step 5: Commit** with `feat(db): product sync RPC, import stock counts, blank barcodes allowed, Starter 5000 products`.

### Task 6: Product sync in the app (types, schema, route, snapshot, merge, store)

**Files:**
- Create: `lib/store/product-sync.ts`, `lib/sync/rejections.ts`
- Modify: `lib/domain.ts`, `lib/sync/request-schema.ts`, `app/api/v1/sync/route.ts`, `app/api/v1/snapshot/route.ts`, `lib/snapshot/types.ts`, `lib/snapshot/map-rows.ts`, `lib/snapshot/merge.ts`, `lib/demo-store.ts`, `hooks/use-demo-products.ts`
- Test: `tests/product-sync.test.mjs`, plus additions to `tests/sync-request.test.mjs`, `tests/snapshot-map.test.mjs` and `tests/snapshot-merge.test.mjs`

**Interfaces:**
- **`lib/domain.ts`:**
  - `Product.taxCategory: TaxCategory`
  - `StockMovement.type` adds `"import-count"`
  - `SyncOperation.entity` adds `"product"`
  - `ProductSyncPayload = { product: Omit<Product, "stock"> }`
  - `StockSyncPayload = { movement: StockMovement; product?: Product; countedStock?: number }`
  - Old caches and the sample seed products without `taxCategory` load as `"standard"`. Normalise this in `parseHostedCache` and in sample hydration.
- **`lib/store/product-sync.ts`:**
  - `stampSequence<T extends { createdAt: string }>(ops: T[], base: Date): T[]`: gives strictly increasing `createdAt` values (base + i ms) so that sync order equals queue order.
  - `heldStockOperations(ops: SyncOperation[]): Set<string>`: ids of stock operations for products whose latest product operation has status `failed`. These are not sent.
  - `productSyncProblems(ops: SyncOperation[]): Map<string /* productId */, string /* owner-facing text */>`
  - `supersedeProductOperations(ops: SyncOperation[], productId: string): SyncOperation[]`: drops earlier non-synced product operations for that product when a new one is queued.
- **`lib/sync/rejections.ts`:** `rejectionText(code: string): string`. It maps:
  - `product_sku_taken` to `Another product already uses this SKU.`
  - `product_barcode_taken` to `Another product already uses this barcode.`
  - `plan_limit_reached` to `Your plan's product limit is reached: upgrade to Pro or archive products.`
  - anything else to the raw code
- **`lib/demo-store.ts` exports:**
  - `addProduct(input: Omit<Product, "id" | "active">): void`. It queues a product operation, then an `opening` movement if stock > 0, using `stampSequence`.
  - `updateProduct(id: string, patch: Partial<Pick<Product, "name" | "sku" | "barcode" | "priceFils" | "lowStockThreshold" | "taxCategory">>): { ok: true } | { ok: false; error: string }`. It checks SKU and barcode uniqueness locally with the messages `SKU and barcode must be unique.`
  - `setProductActive(id: string, active: boolean): { ok: true } | { ok: false; error: string }`. It queues a product operation. Restore checks the plan limit, using the over-limit text with N taken from entitlements.
  - `updateProduct` also queues a product operation, through `supersedeProductOperations`.
  - `applyImport(plan: ImportPlan): { createdIds: string[]; updatedIds: string[] }`. It is one `save()`:
    - for each create: a product operation, then an `opening` movement when stock > 0
    - for each changed update: a product operation if the price or barcode changed, then an `import-count` movement with `countedStock` when the stock changed
    - the movement reason is `Spreadsheet import`
    - new stock operations carry no `product` copy
  - `productLimit(): number | null`, from the current entitlements.
  - The sync loop skips `heldStockOperations`.
  - The route maps entity `product` to `apply_product_sync`, with targetId `payload.product.id`.
- **Merge:** pending or failed product operations overlay the product's fields onto the server snapshot, keeping the server's stock. They add the product, at stock 0, if it is absent. Process operations in `createdAt` order, keeping a running stock per product: `import-count` **sets** the stock to `countedStock`, and other movements and sales add their deltas.

- [ ] **Step 1: Write the failing tests.**
  - **`product-sync.test.mjs`:**
    - `stampSequence` gives strictly increasing times
    - `heldStockOperations` holds the stock operation of a failed product and not one whose product synced
    - `productSyncProblems` uses `rejectionText`
    - `supersedeProductOperations` keeps synced operations
  - **`sync-request.test.mjs`:**
    - a product operation parses
    - `import-count` without `countedStock` is rejected
    - a stock operation without `product` parses
  - **`snapshot-map.test.mjs`:** `tax_category` maps to `taxCategory`.
  - **`snapshot-merge.test.mjs`:**
    - a server snapshot lacking a pending new product still contains it, with stock 0 plus its opening movement
    - a pending `import-count` of 40 followed by a pending sale of 2 gives stock 38 on a server stock of 7
    - a failed product operation keeps the local name over the server name

- [ ] **Step 2: Run** `npm test`. Expected: FAIL in the new and changed tests.

- [ ] **Step 3: Implement** the interfaces above. Also:
  - In the snapshot route, add `tax_category` to the products `select`, and add it to `ProductRow` in `lib/snapshot/types.ts`.
  - Expose `updateProduct`, `setProductActive`, `applyImport` and the sync problems through `useDemoProducts`.

- [ ] **Step 4: Run** `npm test`, `npm run lint` and `npm run typecheck`. Run `npm run build` first if `.next/types` is missing. Expected: all PASS.

- [ ] **Step 5: Commit** with `feat(sync): product operations, import stock counts and VAT category through sync and snapshot`.

### Task 7: Large-import storage fallback

**Files:**
- Modify: `lib/store/hosted.ts`, `lib/offline-db.ts`, `lib/demo-store.ts`
- Test: `tests/hosted-store.test.mjs`

**Interfaces:**
- `HostedCache` gains `savedAt: number` (ms), and `persistOfflineSnapshot` stores `{ ...state, savedAt }`.
- `loadOfflineSnapshot(scope: string): Promise<{ state: Omit<DemoState, "customers">; savedAt: number } | null>` goes in `lib/offline-db.ts`.
- `pickNewerCache(local: { savedAt: number } | null, indexed: { savedAt: number } | null): "local" | "indexed" | null` goes in `lib/store/hosted.ts`.
- `loadUserCache` loads localStorage first, then, asynchronously, the IndexedDB snapshot. It replaces the state when `pickNewerCache` returns `"indexed"`, the same user is still active, and nothing has changed since. Customers are kept or merged as `loadOfflineCustomers` does today.

- [ ] **Step 1: Write the failing tests:**
  - `pickNewerCache(null, { savedAt: 1 })` gives `"indexed"`
  - `pickNewerCache({ savedAt: 5 }, { savedAt: 3 })` gives `"local"`
  - two nulls give `null`
  - `parseHostedCache` of a cache without `savedAt` gives `savedAt: 0`

- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/hosted-store.test.mjs`. Expected: FAIL.

- [ ] **Step 3: Implement** the interfaces.

- [ ] **Step 4: Run** `npm test`. Expected: PASS. The browser proof (fill localStorage, import, reload) is Task 11, check 5.

- [ ] **Step 5: Commit** with `fix(store): recover the outbox from IndexedDB when localStorage is full or stale`.

### Task 8: Import dialog

**Files:**
- Create: `components/catalogue/import-dialog.tsx`
- Modify: `components/inventory-workspace.tsx` (Import button), `app/globals.css`, `package.json` (add `read-excel-file`, exact pinned version)

**Interfaces:**
- Consumes:
  - `guessMapping`, `planImport`, `parseCsv`, `problemsToCsv` and `MAX_IMPORT_ROWS`
  - `applyImport` and `productLimit` from `useDemoProducts`
  - the existing sync trigger: call whatever runs `reconcilePendingOperations` after a sale; find its caller
- Produces: `ImportDialog({ onClose, onPrintLabels(productIds: string[]) })`.

**Steps:**
- [ ] **Step 1: Choose file.**
  - Accept `.xlsx,.csv`.
  - `.csv` goes through `parseCsv` on `file.text()`.
  - `.xlsx` goes through `read-excel-file`, loaded with a dynamic `import()` so it is not in the main bundle. Read only the first sheet, and say so in the copy.
  - Refuse an empty file with `This file has no rows.`
  - Over 5,000 rows, show the `planImport` message.
- [ ] **Step 2: Match columns.**
  - One select per field, prefilled by `guessMapping`, with "Not in this file" as an option.
  - Name and Price are required, and Continue is disabled until both are set.
- [ ] **Step 3: Preview.**
  - Show four groups with counts: New, Updates, Possible duplicates, Problems.
  - Each group is collapsed and shows at most 100 rows, with "and N more".
  - Updates show old → new price and stock.
  - Possible duplicates have a checkbox, ticked by default. Unticked rows are removed from the plan before applying.
  - "Download problem rows" saves `import-problems.csv` (`problemsToCsv`) through a Blob link.
  - The button reads `Import N products` (N = creates + changed updates). It is disabled at 0.
- [ ] **Step 4: Apply and progress.**
  - Call `applyImport`, then the sync trigger.
  - Show "Saved in this browser: N", then "Synced: M of N". M counts this import's operation ids that are no longer pending. Read it from `useDemoStore().syncOperations` by id.
  - Show "Needs attention: K", from `productSyncProblems`, limited to this import's product ids.
  - Sample mode shows only the saved count.
  - The final buttons are `Print labels for these products` (calls `onPrintLabels(createdIds ∪ updatedIds)`) and `Done`.
- [ ] **Step 5: Verify in the browser** on the sample shop at 1024px and 375px:
  - a CSV with 5 rows (2 blank barcodes, 1 matching barcode, 1 bad price) shows New 3, Updates 1, Problems 1
  - importing works
  - there is no horizontal scroll, and all targets are 44px
  - then run `npm run lint` and `npm run typecheck`
- [ ] **Step 6: Commit** with `feat(inventory): import products from Excel or CSV with preview`.

### Task 9: Edit, archive and restore, VAT category, export, unsynced flag

**Files:**
- Create: `components/catalogue/product-form.tsx`
- Modify: `components/inventory-workspace.tsx`, `app/globals.css`

**Interfaces:**
- Consumes: `addProduct`, `updateProduct`, `setProductActive`, `productsToCsv` and `productSyncProblems` (via `useDemoProducts`).
- Produces:
  - `ProductForm({ mode: "add" | "edit"; product?: Product; barcode?: string; onSubmit(values): string | null /* error */; onCancel })`
  - The Add dialog uses `ProductForm` too, keeping the 1C `?barcode=` prefill.

**Steps:**
- [ ] **Step 1: Product form.**
  - Edit opens from an **Edit** button on each row.
  - The form has a VAT select (`Standard (5%)`, `Zero-rated (0%)`, `Exempt`) with the fixed note text.
  - In edit mode, stock is read-only, with an `Adjust stock` button that opens the existing dialog.
- [ ] **Step 2: Archive and restore.**
  - Each row's actions include **Archive**, with a confirm saying `Archived products are hidden from the till. Past invoices are kept.`
  - An `Active / Archived` filter beside the search shows archived products with a **Restore** button. Restore shows `setProductActive` errors inline.
- [ ] **Step 3: Export.** An **Export** button downloads `products-YYYY-MM-DD.csv` using the Dubai date (`dubaiSupplyDate`).
- [ ] **Step 4: Unsynced flag.**
  - Rows in `productSyncProblems` show a red badge reading `Not saved to the server`, with the reason as its text.
  - Above the table, a notice reads `N products need attention`.
- [ ] **Step 5: Verify in the browser** on the sample shop:
  - edit price and VAT and see the changes
  - archive a product: it is gone from `/sale` search and the grid
  - restore it
  - export, then re-import the same file in the import dialog: the preview shows Updates N with every row unchanged, and `Import 0 products` disabled
  - check at 375px
  - then run `npm run lint` and `npm run typecheck`
- [ ] **Step 6: Commit** with `feat(inventory): edit, archive, VAT category, export and unsynced flag`.

### Task 10: Barcode labels

**Files:**
- Create: `components/catalogue/label-print-dialog.tsx`, `components/catalogue/label-sheet.tsx`
- Modify: `lib/print.ts`, `components/inventory-workspace.tsx` (row action, multi-select, import hand-off), `app/globals.css`

**Interfaces:**
- Consumes: `barcodeFor` (Task 4), `formatAED`, `printDocument`.
- Produces:
  - `PrintMode` adds `"labels"`.
  - `printDocument("labels", { pageSize: "50mm 25mm" | "40mm 30mm" })`. It injects a temporary `<style>` with `@page { size: …; margin: 0 }`, prints, and removes it on `afterprint`.
  - `LabelSheet({ items: { product: Product; quantity: number }[]; size })` renders one `.label` per copy, inside `.label-sheet` (shown only in labels print mode).
    - The barcode is an inline SVG with one `<rect>` per run of `1` modules. Its height fits the label, and there is a quiet zone of at least 10 modules on each side.
    - The value text sits below the barcode.
    - The name is clamped to 2 lines with an ellipsis.
    - The price is in `AED 12.50` format.
  - `LabelPrintDialog({ products: Product[]; onClose })`:
    - a quantity per product, defaulting to 1 for a single product and to the stock (minimum 1) for a selection
    - a size select, remembered in localStorage under `shop-ledger-label-size-v1` (wrapped in try/catch)
    - a total-labels count
    - **Print**
- Inventory changes:
  - a row checkbox column, with a **Print labels (n)** toolbar button
  - a per-row **Print labels** action
  - `ImportDialog.onPrintLabels` opens the dialog with those products

**Steps:**
- [ ] **Step 1: Build** the components and CSS. In labels print mode, everything except `.label-sheet` is hidden, each `.label` has `break-after: page`, and the sheet sits outside any `overflow: hidden` or positioned ancestor (the 1C lesson).
- [ ] **Step 2: Verify in the browser:**
  - Open the dialog for 2 products × 2 copies. The total is 4.
  - Using JS, set `data-print-mode="labels"` and apply the print styles through `matchMedia` emulation if available. Otherwise check that `.label-sheet` has 4 `.label` children with no clipping ancestor (the same ancestor check as 1C).
  - Each label's SVG rect count matches its modules.
  - Then run `npm run lint` and `npm run typecheck`.
- [ ] **Step 3: Commit** with `feat(inventory): print barcode labels on thermal label printers`.

### Task 11: End-to-end smoke on local Supabase, and the full suite

**Files:** none, unless a defect is found. Each fix gets a failing test first and a `fix:` commit.

- [ ] **Step 1: Setup.**
  - `supabase db reset`
  - create the local test owner, with credentials only in the git-ignored `.env.local`
  - start the dev server on port 3101 from this worktree
  - clear the 3101 origin's storage, and only `sb-127-*` cookies
  - set up the shop and open the register
- [ ] **Step 2: Run these checks and record each result in the ledger.**
  1. **A 6-row `.xlsx`** (create one with a short Node script using a minimal hand-built xlsx, or have the owner provide one; otherwise use CSV and note it):
     - barcodes as numbers, 2 blank barcodes, one `AED 12.50` price, one `12,50`
     - expect New 5, Problems 1
     - import; then DB: 5 products, both blank-barcode rows present, prices in fils correct
  2. **Export, then re-import the exported CSV:** 0 changes.
  3. **Edit the exported CSV:** change one stock 10 → 4 and one price. Re-import: Updates 2 changed. DB:
     - stock 4, with an `import_count` movement of −6 and reason `Spreadsheet import`
     - the new price
  4. **A 5,000-row generated CSV:**
     - the preview appears without freezing (note the seconds)
     - import; the outbox drains to 0
     - with 5 active products already, the preview shows 4,995 creates and 5 over-limit problems
     - DB: exactly 5,000 active products
     - record the counts
  5. **Offline import, then a reconnect and a snapshot refresh:** no product lost or duplicated, and stock correct.
     - Optionally, fill localStorage close to its quota first, import 200 rows, reload, and check that the IndexedDB fallback restored all pending operations.
  6. **Rejection:** with SQL, create a product that holds barcode X on the server only, then import a row with barcode X. The local row shows `Not saved to the server — Another product already uses this barcode.` Editing the barcode clears the flag after sync.
  7. **Product with 0 stock** added through Add product: it reaches the server.
  8. **Labels:**
     - print for a product without a barcode
     - check the print preview shows one label per page at 50×25mm
     - scan or type its SKU at `/sale`: it is added
  9. **At 375px:** the import dialog, edit form and label dialog are usable, with no horizontal scroll.
- [ ] **Step 3: Run** `npm test`, `npm run test:sql`, `npm run test:rehearsal`, `npm run lint`, `npm run typecheck` and `npm run build`. Expected: all pass. Record `1D smoke passed`, with the observed values.
