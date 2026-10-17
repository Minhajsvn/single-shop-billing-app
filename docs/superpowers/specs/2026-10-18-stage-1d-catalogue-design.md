# Stage 1D: Catalogue — design

Parent spec: `docs/superpowers/specs/2026-10-11-saas-plans-and-improvements-design.md` (Stage 1, item 5).
Sub-plan table: `docs/superpowers/plans/2026-10-11-stage-1-starter-launch.md` (row 1D).
Builds on 1A (`products.tax_category` column), 1B (hosted store, offline outbox, snapshot), and 1C (checkout, `findByCode`).

## 1. Intent

A UAE grocery or electronics shop moving onto Shop Ledger already has its products in an Excel sheet. **Getting those products in is the step that hurts most** (owner's words). If it is clumsy, the shop never gets to its first sale. 1D makes that step painless, then covers the day-to-day catalogue work around it: fixing a product, exporting the list, and printing shelf/barcode labels.

**Success:** an owner uploads their Excel file of a few thousand rows. They see clearly what will happen and confirm. A minute or two later every product is in the shop and synced to the server. They can print barcode labels on their thermal printer and scan them at the till.

## 2. Decisions taken with the owner

| Topic | Decision |
|---|---|
| Priority | Import from a spreadsheet matters most; editing, export and labels are lighter. |
| Owner's typical file | Excel, with columns name, barcode, price, stock. Some barcodes are blank. |
| Re-importing a row that matches an existing product | Match by **barcode first, then by SKU**. On a match, update that product's **price and stock**. If the row's barcode and SKU point to two different products, the row goes to Problems. |
| Any other row | Add it as a new product. |
| Starter plan product limit | **Raised from 1,000 to 5,000** (`lib/billing/plans.ts` and the plan catalogue in the database). |
| Stock on a matched row | **Replace** the current stock with the file's number (a stock count, not a delivery). Record the difference as a stock movement with reason "Spreadsheet import". |
| Labels | **Thermal label printer.** Each label shows barcode, name and price. |
| VAT category | **Store and edit it only.** Checkout, invoices and VAT reports keep charging standard 5%, and using the category belongs to a later phase. |
| Size | The biggest shops have **a few thousand** products. |

## 3. Goals

1. **Import** `.xlsx` and `.csv` files with a preview-then-confirm flow.
2. **Edit** a product's name, SKU, barcode, price, low-stock threshold and VAT category. **Archive and restore** a product.
3. **Export** the catalogue as a CSV in the same layout the import reads, so export, edit in Excel and re-import is a round trip.
4. **Print barcode labels** on a thermal label printer, for one product or a selection.
5. **Store a VAT category** (standard / zero-rated / exempt) per product, carried through sync and snapshot.
6. **Fix two pre-existing gaps the import depends on** (found in recon, §6).

## 4. Non-goals

- Using the VAT category at checkout, on invoices or in reports. It is stored only, and every sale stays at 5%.
- Product images, categories and departments, variants, suppliers, cost price and margin. Categories and margin are Stage 2 Pro features.
- Weighed items and scale barcodes (Stage 2).
- Exporting `.xlsx`. CSV opens in Excel; see §7.4.
- A4 sticker-sheet label printing (the owner uses a thermal printer).
- Bulk price-change tools other than re-import.
- Editing stock directly in the edit form. Stock keeps changing only through Adjust stock, import or sales, so every change has a reason.

## 5. Anti-goals: things that would make 1D a failure even if it "works"

- **Silent guessing on money.** A price the app can't read with certainty (`12,5`, `AED twelve`, `—`) is flagged in the preview and never guessed.
- **Saving before the owner confirms.** Nothing is written until they press Import.
- **Quietly creating duplicates.** If a no-barcode row's name matches an existing product, the preview warns about it.
- **A half-finished import with no explanation.** If the tab closes or the network drops partway, everything already confirmed must still reach the server through the outbox. The owner can see what happened.
- **Stock changes without a trace.** Every import stock change is a stock movement.
- **Breaking past invoices.** Editing a product's price or name never changes completed sales; their lines hold their own copies.

## 6. Pre-existing gaps that 1D must fix (found in recon)

1. **Only one product per shop can have a blank barcode.**
   - The constraint is `unique nulls not distinct (business_id, barcode)` in `supabase/migrations/202608300001_sprint_one_foundation.sql:45`. Blank barcodes are stored as NULL, so the server rejects the second barcode-less product.
   - The owner's files have several blank barcodes.
   - **Fix:** a migration that makes barcode unique only where it is not null, so blanks are distinct.
2. **Products reach the server only through an "opening" stock movement.**
   - In `apply_stock_sync` (latest body in `202610130016_tills_and_sync_device.sql`), a product is created only when a stock movement of type `opening` references it.
   - `addProduct` in `lib/demo-store.ts` queues nothing when the opening stock is 0, so **a hosted product added with 0 stock never syncs.**
   - **No sync path exists to change an existing product** (name, price, barcode, threshold, active).
   - **Fix:** a dedicated product sync operation (§7.1).

## 7. How it works

### 7.1 Product sync operation (foundation for everything else)

- **New outbox entity `"product"`.**
  - The payload is the full product: id, name, sku, barcode, priceFils, lowStockThreshold, active, taxCategory, plus the device id. Stock is never part of it.
  - The client queues it whenever a product is created or edited.
  - The server applies it through a new security-definer RPC (`apply_product_sync`), following the conventions of the existing sync RPCs:
    - owner-only
    - idempotent by `operation_id` via `sync_operations`
    - `search_path = public, extensions, pg_temp`
    - business-scoped, rejecting ids that belong to another business
  - The RPC upserts by id.
  - Unique-SKU or unique-barcode violations come back as clear, named rejections (`product_sku_taken`, `product_barcode_taken`), never raw constraint text.
- **Stock stays separate.**
  - Opening stock on a new product is still a stock movement (type `opening`).
  - That movement is queued **after** the product operation, so it finds the product on the server.
  - Stock changes from import use a new movement type `import_count`. *(Design call: §11.)*
    - It carries the **counted stock** (the file's number), not a delta.
    - The server sets the product's stock to that number and records the difference as the movement's `quantity_delta`.
    - Unsynced sales on this till, and sales from another till (Pro allows 2, Business 6), therefore can't push the count off or get it rejected as `insufficient_hosted_stock`.
    - If the server's stock already equals the count, the operation is accepted and no movement row is written.
    - Locally, the preview and the movement use this browser's current stock for "old stock".
    - This needs the enum value, a payload field (`countedStock`), and the matching handling in `apply_stock_sync`. Alternatively it could be a separate RPC; that's the builder's choice.
- **Rejected products** *(design call: §11)*.
  - If the server rejects a product operation, the product stays in the shop locally, because it may already be on a held cart or a sale. Possible rejections: `product_sku_taken`, `product_barcode_taken`, `plan_limit_reached`.
  - The product is marked **"Not saved to the server"** on Inventory, with the reason in plain words. The owner fixes it through Edit product, which queues a new product operation.
  - Stock operations for that product wait behind it rather than failing on their own.
  - The import progress view and Inventory both show how many products need attention.
- **Storage for large imports** *(design call: §11)*.
  - The hosted cache, including the outbox, is written to localStorage, and a quota error is swallowed. The outbox is also already written to IndexedDB (`persistOfflineSnapshot`).
  - 1D must make a confirmed import of 5,000 rows survive a full localStorage and a closed tab:
    - loading falls back to the IndexedDB outbox when localStorage is missing or stale
    - stock operations stop carrying a full product copy where the product operation already precedes them
  - Pin this with a test that fills localStorage, imports, reloads, and checks every operation is still pending.
- **Sync order.** The outbox already syncs in order, 50 operations per request. A few thousand imported products is about 60 requests; the progress shown is the outbox draining.
- **Snapshot and types.**
  - `Product` gains `taxCategory: "standard" | "zero" | "exempt"`.
  - The snapshot route and `mapRows` read `tax_category`.
  - Sample mode defaults to `"standard"`.

### 7.2 Import flow

The entry point is an **Import** button on the Inventory page. The flow is a full-width dialog with three steps.

1. **Choose file.** Accepts `.xlsx` and `.csv`.
   - Only the first worksheet of an `.xlsx` is read, and the dialog says so.
   - The first non-empty row is taken as the headings.
   - Parsing happens in the browser; the file never goes to the server as a file.
2. **Match columns.**
   - The app guesses the mapping from heading names, case-insensitive and in English and common Arabic. For example:
     - "name", "item", "product", "description", "اسم" map to **Name**
     - "barcode", "ean", "upc", "باركود" map to **Barcode**
     - "price", "selling price", "price (aed)", "سعر" map to **Price**
     - "stock", "qty", "quantity", "كمية" map to **Stock**
     - "sku", "code", "item code" map to **SKU**
     - "low stock", "reorder" map to **Low-stock threshold**
     - "vat", "tax" map to **VAT category**
   - The owner can change any mapping.
   - **Name** and **Price** are required. All other columns are optional.
3. **Preview.** Rows are sorted into groups, each with a count and an expandable list:
   - **New products.**
   - **Updates.** The barcode, or failing that the SKU, matches an existing product. Each row shows the old and new price and the old and new stock.
   - **Possible duplicates** (warning only). The row matched nothing by barcode or SKU, and its name matches an existing product, ignoring case and spacing. These rows are still added as new unless the owner unticks them, and the warning says so.
   - **Problems** (skipped). Each row lists its reasons:
     - missing name
     - unreadable or ≤ 0 price
     - stock not a whole number ≥ 0
     - barcode repeated within the file (all copies are flagged)
     - barcode and SKU match two different existing products
     - SKU repeated within the file
     - barcode longer than the server limit
     - over the plan's product limit (see Writing)
   - The owner can **download the problem rows** as a CSV with a reason column, fix them in Excel and import that file later.

   **Import N products** confirms the import. A progress view then shows rows saved locally and then rows synced, from the outbox count.

**Matching an existing product (owner's decision: barcode first, then SKU):**
- **Barcode first.** If the row has a barcode, it is compared after trimming. Leading zeros are significant, and a barcode read by Excel as a number is restored to digits without exponent notation.
- **Then SKU.** If there's no barcode match and the row has a SKU, the SKU is compared case-insensitively after trimming.
- **Conflict.** If the barcode matches product A and the SKU matches a different product B, the row goes to Problems.
- **Adding a barcode.** If the row matched by SKU and carries a barcode the product doesn't have yet, the barcode is set on that product, provided no other product uses it. This covers the owner typing barcodes into an exported sheet.
- On a match the row updates **price and stock** (plus a newly added barcode); name, SKU and others are left alone.
- An archived product that matches is updated and stays archived; the preview row says "archived".

**New-product fields:**
- **SKU.** Taken from the file's SKU column if it is mapped and non-empty. Otherwise it is generated as `P-0001`, `P-0002` and so on, continuing after the highest existing `P-` number in the shop, so SKUs never collide.
- **Low-stock threshold.** From the file, or 5 (the current form default).
- **VAT category.** From the file, if it reads clearly as standard, zero or exempt; otherwise standard. A cell the app cannot read clearly sends the row to Problems, never a guess.

**Value parsing (strict; anything else is a problem row):**
- **Price** accepts `12`, `12.5`, `12.50`, `AED 12.50`, `12.50 AED`, `1,234.50` (comma as thousands separator) and a numeric Excel cell. It rejects `12,50` (ambiguous), more than 2 decimals, negatives, 0 and text. Prices are VAT-inclusive, as everywhere in the app.
- **Stock** accepts a whole number ≥ 0 (a numeric cell `40` or `40.0` is fine) and rejects `4.5`, negatives and text. A blank stock cell on a new product means 0. A blank stock cell on an update leaves stock unchanged.
- **Text** is trimmed. Arabic text is kept as is. Names longer than the server limit (160) are a problem, not truncated.

**Writing:**
- On confirm, all rows are applied to the local store in one state update and queued to the outbox:
  - a product operation for each new or updated product
  - an `opening` movement for each new product with stock > 0
  - an `import_count` operation for each update whose stock changed locally
- In sample mode the same happens locally, with nothing synced.
- **Limit:** 5,000 data rows per file. A bigger file is refused in step 1 with a message to split it.
- **Plan product limit.**
  - Starter becomes 5,000 (owner's decision); Pro and above have no limit.
  - The database trigger `products_plan_limit` counts active products and fires on insert and on re-activation.
  - The preview counts existing active products plus new rows. Rows past the limit go to Problems as "Over your plan's limit of N products: upgrade to Pro", and the rows before them import normally.
  - Restore of an archived product checks the same limit locally.
  - `apply_product_sync` turns the trigger's error into a named `plan_limit_reached` rejection.
- **Raising Starter to 5,000.**
  - Change `lib/billing/plans.ts`.
  - Add a new migration that updates the plan catalogue row.
  - Run the existing plan-catalogue consistency check (`scripts/plan-catalog-sql.mjs`, `npm test`) so code and database agree.

### 7.3 Editing and archiving

- **Edit product** opens from each inventory row and uses the same form as Add product, plus a VAT category select. Stock is shown read-only, with a link to Adjust stock.
- Uniqueness of SKU and barcode is checked locally first, with the same messages as Add. The server enforces it again (§7.1).
- **Archive** sets the product to inactive. Archived products are hidden from the POS (already true through `findByCode` and the product grid) and listed under an **Archived** filter on Inventory, where **Restore** brings them back. There is no hard delete, because past invoices and stock movements reference the product.
- Editing never changes completed sales or held carts. Held carts already re-check products on resume (1C).

### 7.4 Export

- An **Export** button on Inventory downloads `products-YYYY-MM-DD.csv`.
- Columns: Name, SKU, Barcode, Price (AED), Stock, Low-stock threshold, VAT category, Status. The headings are exactly what the import's mapper recognises.
- The file is UTF-8 with a byte-order mark, so Excel shows Arabic names correctly.
- Barcodes are written so Excel keeps them as text and does not show `6.29E+12`. **Builder:** pick and test a technique that survives opening and re-saving in Excel.
- All products are included, archived ones too (Status column). On re-import, the import ignores Status.

### 7.5 Barcode labels

- **Printing from one product:** on its row, Print labels → quantity, default 1.
- **Printing from several products:** tick products in the inventory table → Print labels → one quantity for each selected product, defaulting to each product's current stock and editable before printing. The products just imported are a natural selection, so the import's final screen offers **Print labels for these products**.
- **Label content:** product name (up to 2 lines, then cut off with an ellipsis), price (`AED 12.50`), and the barcode with its digits printed under it.
- **Symbology:** EAN-13 when the code is 13 digits with a valid check digit, otherwise Code 128. A product without a barcode prints its **SKU as a Code 128** barcode. The till's `findByCode` already matches SKU, so scanning that label adds the product (verify this end to end).
- **Size:** a label-size setting on the print dialog, either 50×25mm (default) or 40×30mm. It is remembered per browser.
- Printing uses the browser print dialog with a dedicated print mode (`printDocument("labels")`), in the same way as receipts. `@page` is sized to the label, so each label is one page, which is how thermal label printers expect it.
- **No printer drivers or direct printer protocols** (ZPL/TSPL) in 1D.

### 7.6 VAT category

- A select on Add and Edit product: Standard (5%), Zero-rated (0%), Exempt.
- It is carried in the product sync payload and the snapshot.
- Import and export carry it (§7.2, §7.4).
- Text next to the select states plainly that checkout currently charges 5% on every product.

## 8. Constraints

- Follow `AGENTS.md`: this Next.js version differs from training data, so read `node_modules/next/dist/docs/` before using framework APIs.
- **Money:** integer fils. Parse with strings and regex, never floats from text. A numeric Excel cell is converted by rounding to 2 decimals; more precision than that is a problem row.
- **Migrations:**
  - new files only; never edit applied ones
  - re-apply the `search_path = public, extensions, pg_temp` hotfix on any redefined RPC
  - add SQL tests to `supabase/tests/foundation_test.sql`
  - test locally with `supabase db reset`, `npm run test:sql` and `npm run test:rehearsal`
  - never push to hosted Supabase
- **Tests:** pure logic goes in `lib/catalogue/*` with relative `.ts` imports, so the Node test runner can load it. This covers the header mapper, value parsers, row classifier, SKU generator, CSV writer and barcode encoding.
- **ESLint React-compiler rules:** no setState synchronously in effects, no ref access during render.
- **Phone width (375px):** import, edit and print dialogs must be usable, with no horizontal page scroll and 44px touch targets.
- **New dependencies:** at most one small, maintained spreadsheet reader for `.xlsx` and at most one barcode renderer, each with an exact pinned version. Prefer libraries without known vulnerabilities; the npm `xlsx` package (0.18.x) has open advisories. Writing EAN-13 and Code 128 encoding ourselves is acceptable if it's tested.

## 9. Left to the builder

- The exact libraries (within §8), and the internal structure of the import dialog.
- Whether rows in the preview are virtualised. A few thousand rows must not freeze the page; collapsed group lists and a capped visible count are fine.
- Visual design of labels within the stated content and sizes.
- How the import progress view reads the outbox count.

## 10. Review focus (likely to bite; tests should pin them)

1. Excel barcodes stored as numbers: `6291100211014` read as a float, or shown as `6.29E+12`. Leading zeros lost (`0012345`).
2. A file with several blank barcodes imports all of them, and the server accepts them (§6.1).
3. Re-importing the exported file changes nothing. Every row matches by barcode or SKU, including products without a barcode. No movements are queued and nothing is flagged.
4. Import partway through when the tab closes: everything confirmed still syncs later, with no duplicates (operations are idempotent).
5. A row's SKU collides with a different existing product, or the generated SKU collides with one the owner typed: never a server rejection that the preview could have predicted.
6. A hosted product with 0 opening stock reaches the server (§6.2).
7. Two tills: the import's stock count lands correctly when the other till sold the product before the import synced.
8. A product the server rejects stays usable locally, is shown as "Not saved to the server" with the reason, and is fixed through Edit.
9. A Starter shop with 4,990 active products importing 20 new rows: 10 are imported and 10 are shown as over the limit.

## 11. Calls made by the designer (not the owner); check these

- **Import stock is a count.** It is sent as the counted number, and the server computes the difference. This follows from the owner's "replace" decision combined with multiple tills (§7.1).
- **Rejected products stay local**, flagged "Not saved to the server" and fixed through Edit (§7.1).
- **Large-import storage.** It relies on the existing IndexedDB outbox copy and slimmer stock payloads, not a full move off localStorage (§7.1).
- **Supported files are `.xlsx` and `.csv`**, not CSV only as the parent spec says. Owners struggle with "save as CSV".
- **Generated SKUs** are `P-0001` and so on. The low-stock threshold defaults to 5.
- **Labels:** 50×25mm by default, with 40×30mm as the other size. EAN-13 when the code is valid, otherwise Code 128. A product without a barcode prints its SKU as a barcode.
- **Export is CSV only**, UTF-8 with a byte-order mark.
