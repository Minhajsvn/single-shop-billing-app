# Stage 2D Suppliers and Deliveries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Pro shop keeps a supplier list and records deliveries online; each delivery adds stock and moves product
cost to a weighted average, can be voided, and feeds a purchases CSV with input VAT.

**Architecture:** Two migrations add RLS-locked tables reached only through security-definer functions (no table
privileges for members). Next.js route handlers wrap those functions; the browser calls them online only and keeps
nothing in IndexedDB. A new `/purchases` area (list, record, detail, suppliers) is open to owner and manager.

**Tech Stack:** Next.js 16 app router (read `node_modules/next/dist/docs/` before writing routes/pages), Supabase
Postgres, zod, `node --test` with `--experimental-strip-types`, `npm run test:sql`.

**Spec:** `docs/superpowers/specs/2026-11-11-stage-2d-purchasing-design.md`

## Global Constraints

- Feature key `purchasing` (Pro). Owner and manager only; cashiers never reach purchases data or buying prices.
- Online only: no delivery, supplier or buying price is written to IndexedDB or localStorage.
- Weighted average: `round((greatest(stock,0) × coalesce(cost, unit) + qty × unit) / (greatest(stock,0) + qty))`; no cost yet → the new unit cost.
- Limits: 1–200 lines; quantity 1–100000; unit cost 0–100000000 fils; VAT 0..net; supplier name 1–80; TRN null or 15 digits; invoice no. 1–40; void reason 1–200; list range ≤ 92 days.
- Refusal codes (P0001 unless noted): `not_authorized` (42501), `feature_not_in_plan`, `invalid_supplier`, `supplier_name_taken`, `supplier_not_found`, `invalid_receipt`, `duplicate_line`, `product_not_found`, `product_archived`, `duplicate_supplier_invoice`, `invalid_vat`, `receipt_not_found`, `already_voided`, `invalid_reason`, `stock_too_low`, `invalid_range`.
- Migrations: `202611110057_suppliers.sql`, `202611110058_purchase_receipts.sql`. Never edit 001–056.
- Local Supabase only for tests. Browser checks run the worktree on its own port with a temporary launch entry and must confirm the bundle calls `127.0.0.1:54321` before any sign-in (main checkout's `.env.local` is production).
- Node tests import with relative `.ts` paths. Keep CRLF files CRLF. Lint has zero warnings.
- Copy fixed by the spec: "Recording a delivery needs a connection", "Record supplier deliveries and keep costs up to date on Pro", "For supplier deliveries, use Purchases → Record delivery.", "This supplier invoice is already recorded on {date}.", "Restore {name} first.", "{name}: only {n} left; record a correction in Inventory instead.", CSV headings "Date","Supplier","Supplier TRN","Invoice no.","Net AED","VAT AED","Gross AED","Voided".

## Review Focus

1. **Scanning the same barcode twice** → the existing line's quantity goes up by 1; no second line (Task 3 test `mergeLines adds a repeat scan`).
2. **A product with negative stock or no cost** → the page's preview equals what the server saves (Task 3 test `costPreview matches the SQL formula`, Task 2 SQL test 2f/2g).
3. **Save pressed twice or retried after a timeout** → one delivery, one stock rise (Task 2 SQL test 2h; Task 4 test that a retry re-sends the same id).
4. **Voiding after part of the delivery sold** → refused with the product's name and what is left (Task 2 SQL test 2m; Task 4 error text test).
5. **Recording just after midnight Dubai time** → invoice date defaults to the Dubai date, not UTC (Task 3 test `defaultInvoiceDate uses Dubai`).

---

### Task 1: Suppliers migration (057)

**Files:** Create `supabase/migrations/202611110057_suppliers.sql`, `supabase/tests/purchasing_test.sql` (suppliers part; Task 2 appends at `-- @@RECEIPTS@@`).

**Interfaces — Produces:** table `suppliers`; `purchasing_check(p_business_id uuid) returns void` (revoked from members); `supplier_list(p_business_id uuid) returns table(id uuid, name text, trn text, phone text, email text, note text, archived boolean, created_at timestamptz)`; `supplier_save(p_business_id uuid, p_supplier jsonb) returns uuid` with payload `{ id, name, trn?, phone?, email?, note?, archived? }`.

- [ ] **Step 1: Failing SQL tests** (fixture like `categories_margin_test.sql`: owner A on Pro trial with manager and cashier, owner B moved to Starter):
  - 1a owner saves `{"id":…,"name":" Al Noor Trading ","trn":"100000000000003"}` → name trimmed; `supplier_list` returns it.
  - 1b same id again with a new phone updates, no second row.
  - 1c second live supplier named `al noor trading` → `supplier_name_taken`; after archiving the first, allowed.
  - 1d name `''` or 81 chars, TRN `12345` → `invalid_supplier`.
  - 1e another shop's supplier id → `supplier_not_found`.
  - 1f manager saves and lists; cashier → 42501; Starter owner → `feature_not_in_plan`.
  - 1g cashier `select * from suppliers` → `insufficient_privilege`.
- [ ] **Step 2:** `npm run test:sql` → FAIL (function missing).
- [ ] **Step 3: Write 057.** Table per spec §4 with partial unique index on `(business_id, lower(name)) where archived_at is null`; `enable row level security`; `revoke all … from anon, authenticated`. `purchasing_check` mirrors `cost_reader_check` (202611100054) with feature `purchasing`. Functions `security definer set search_path = public, extensions, pg_temp`; execute granted to `authenticated` except `purchasing_check`. Audit `supplier.save` with the saved fields.
- [ ] **Step 4:** apply locally (direct postgres, as in 2C), `npm run test:sql` → all PASS.
- [ ] **Step 5:** commit `feat(2d): suppliers`.

### Task 2: Deliveries migration (058)

**Files:** Create `supabase/migrations/202611110058_purchase_receipts.sql`; modify `supabase/tests/purchasing_test.sql`.

**Interfaces — Consumes:** Task 1. **Produces:** tables `purchase_receipts`, `purchase_receipt_lines`;
`record_purchase_receipt(p_business_id uuid, p_receipt jsonb) returns jsonb` (the saved receipt as `purchase_receipt_get` returns it);
`void_purchase_receipt(p_business_id uuid, p_receipt_id uuid, p_reason text) returns void`;
`purchase_receipt_list(p_business_id uuid, p_from date, p_to date, p_supplier uuid default null) returns jsonb` (array of `{ id, supplierId, supplierName, supplierTrn, supplierInvoice, invoiceDate, lineCount, netFils, vatFils, grossFils, createdAt, voidedAt }`);
`purchase_receipt_get(p_business_id uuid, p_id uuid) returns jsonb` (header as above plus `note, voidReason, receivedBy, lines: [{ productId, productName, sku, quantity, unitCostFils, lineNetFils, costBeforeFils, costAfterFils }]`);
`product_last_delivery(p_business_id uuid) returns table(product_id uuid, invoice_date date, supplier_name text, unit_cost_fils bigint)`.

- [ ] **Step 1: Failing SQL tests** (products P1 stock 10 cost 500, P2 stock 0 no cost, P3 stock −3 cost 400, P4 archived):
  - 2a delivery: P1 ×10 @600, P2 ×5 @250 → P1 stock 20 cost 550; P2 stock 5 cost 250.
  - 2b two `receipt` stock movements with `source_id` = receipt id and reason starting "Delivery".
  - 2c lines keep `cost_before_fils`/`cost_after_fils` (500→550; null→250).
  - 2d net 7250, VAT 363 (sent), gross 7613 stored.
  - 2e audit rows `purchase.receipt` and two `product.cost` with `receiptId`.
  - 2f P3 ×10 @700 → cost round((0×400 + 10×700)/10) = 700, stock 7.
  - 2g one line at unit 0 allowed; cost moves toward 0 by the formula.
  - 2h same receipt id again → same row, P1 stock still 20.
  - 2i same supplier + invoice `inv-1` (case-insensitive) on a new id → `duplicate_supplier_invoice`; after voiding the first, allowed.
  - 2j P1 twice in one payload → `duplicate_line`; 201 lines → `invalid_receipt`; quantity 0 → `invalid_receipt`; VAT > net → `invalid_vat`; P4 → `product_archived`; another shop's product → `product_not_found`; archived supplier → `supplier_not_found`.
  - 2k void: stock back by each quantity, `correction_out` movements, cost unchanged, voided fields set.
  - 2l void again → `already_voided`; empty reason → `invalid_reason`.
  - 2m sell (set stock directly) P1 down to 5, void a 10-unit delivery → `stock_too_low` whose message names the product (`stock_too_low:P1 name:5`).
  - 2n list for the day returns both deliveries with `voidedAt` on the voided one; 93-day range → `invalid_range`; `purchase_receipt_get` returns lines with names; `product_last_delivery` returns the latest non-voided delivery per product.
  - 2o cashier: every function 42501 and `select` on both tables → `insufficient_privilege`; manager: record and void allowed; Starter: `feature_not_in_plan`.
- [ ] **Step 2:** `npm run test:sql` → FAIL.
- [ ] **Step 3: Write 058.** Tables and checks per spec §4; unique index on `(business_id, supplier_id, lower(supplier_invoice)) where supplier_invoice is not null and voided_at is null`; RLS on, privileges revoked. `record_purchase_receipt`: validate payload first, then return early when the id exists for this shop; lock products `order by id` with `for update`; compute per line with the Global Constraints formula; insert movements with `type 'receipt'`, `created_by auth.uid()`. `stock_too_low` raises `message = 'stock_too_low'` and `detail = '<product name>:<stock>'` (the route reads `detail`). Correct the 2m expectation to that shape when writing the test.
- [ ] **Step 4:** apply locally; `npm run test:sql` → all PASS (2C and 2B suites still PASS).
- [ ] **Step 5:** commit `feat(2d): deliveries with weighted-average cost`.

### Task 3: Delivery draft helpers

**Files:** Create `lib/purchasing/draft.ts`, `lib/purchasing/types.ts`, `lib/purchasing/csv.ts`; Test `tests/purchasing-draft.test.mjs`.

**Interfaces — Produces:**
- `types.ts`: `Supplier = { id; name; trn: string | null; phone: string | null; email: string | null; note: string | null; archived: boolean }`; `ReceiptSummary` and `ReceiptDetail` mirroring Task 2's jsonb keys.
- `draft.ts`: `type DraftLine = { productId: string; quantity: number; unitCostFils: number }`;
  `mergeLines(lines: DraftLine[], add: { productId: string; unitCostFils: number }): DraftLine[]` (repeat product → quantity + 1, keeps its cost);
  `draftTotals(lines: DraftLine[], vatOverride: number | null): { netFils: number; vatFils: number; grossFils: number }` (VAT default `Math.round(net × 0.05)`);
  `costPreview(stock: number, costFils: number | null, quantity: number, unitCostFils: number): number` (the Global Constraints formula);
  `validateDraft(draft: { supplierId: string | null; lines: DraftLine[]; vatFils: number }): string | null` (first problem in plain words: "Choose a supplier.", "Add at least one product.", "Quantities must be whole numbers from 1 to 100,000.", "Unit costs must be from 0 to 1,000,000 AED.", "VAT cannot be more than the net amount.", "A delivery can have at most 200 lines.");
  `defaultInvoiceDate(now: Date): string` (Dubai date via `uaeBusinessDate`).
- `csv.ts`: `purchasesCsv(rows: ReceiptSummary[]): string` with the fixed headings, AED 2 decimals, "Yes"/"" for Voided, `safeCsv` from `lib/reporting.ts`.

- [ ] **Step 1: Failing tests:** `mergeLines adds a repeat scan` (two adds of p1 → one line quantity 2); `draftTotals` net 7250 → VAT 363, override 360 kept; `costPreview matches the SQL formula` for (10,500,10,600)→550, (0,null,5,250)→250, (−3,400,10,700)→700, (5,0,5,0)→0; each `validateDraft` message; `defaultInvoiceDate uses Dubai` (2026-12-31T21:30Z → "2027-01-01"); CSV first line and a voided row.
- [ ] **Step 2:** `npm test` → FAIL. **Step 3:** implement. **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** commit `feat(2d): delivery draft helpers`.

### Task 4: Purchasing API routes and client

**Files:** Create `lib/purchasing/errors.ts`, `lib/purchasing/route.ts`, `lib/purchasing/client.ts`; routes `app/api/v1/suppliers/route.ts` (GET list, PUT save), `app/api/v1/purchases/route.ts` (GET `?from&to&supplier`, POST record), `app/api/v1/purchases/[id]/route.ts` (GET), `app/api/v1/purchases/[id]/void/route.ts` (POST `{ reason }`), `app/api/v1/purchases/last-delivery/route.ts` (GET). Test `tests/purchasing-client.test.mjs`.

**Interfaces — Consumes:** Tasks 1–3; `staffSession`, `readJson` (`lib/staff/route.ts`); pattern of `lib/profit/route.ts`.
**Produces:** `purchasingErrorMessage(code: string, detail?: string): string`; in `client.ts` (each takes optional `deps: { fetch? }`, returns `{ ok: true; … } | { ok: false; error: string; offline?: boolean }`): `listSuppliers()`, `saveSupplier(s: Supplier)`, `listReceipts(from, to, supplierId?)`, `getReceipt(id)`, `recordReceipt(payload)`, `voidReceipt(id, reason)`, `lastDeliveries()` → `Map<productId, { invoiceDate; supplierName; unitCostFils }>`. Offline error text: "Recording a delivery needs a connection" for `recordReceipt`, "Purchases need a connection" otherwise.

- [ ] **Step 1: Failing tests:** each refusal code's message (incl. `stock_too_low` with detail "Dates 1kg:5" → "Dates 1kg: only 5 left; record a correction in Inventory instead."; `duplicate_supplier_invoice` with detail "2026-11-09" → "This supplier invoice is already recorded on 2026-11-09."; `product_archived` detail "Cola" → "Restore Cola first."); `recordReceipt` posts JSON to `/api/v1/purchases`; a thrown fetch → offline text; a retry sends the identical body (same id); route mapping 42501 → 403, `feature_not_in_plan` 403, `*_not_found` 404, others 400, unknown 500, all `Cache-Control: no-store`.
- [ ] **Step 2:** FAIL. **Step 3:** implement; routes validate ids with a uuid regex and bodies with zod (limits from Global Constraints) before calling the RPC; `duplicate_supplier_invoice` detail is the earlier invoice date. **Step 4:** PASS; `tsc` + lint clean.
- [ ] **Step 5:** commit `feat(2d): purchasing API routes`.

### Task 5: Manager pages and navigation

**Files:** Modify `lib/access/cashier.ts`, `tests/cashier-access.test.mjs`.

**Interfaces — Produces:** `MANAGER_PAGES = ["/purchases", "/reports"]`; `canUsePage(role, pathname, tab)` lets `manager` open those; `navLinksFor("manager")` = selling links, then `{ href: "/purchases", label: "Purchases" }` after Inventory, then Reports, then the Data-tab Settings link; owner links gain Purchases after Inventory.

- [ ] **Step 1:** update the failing tests: `canUsePage("manager", "/reports") === true`, `canUsePage("manager", "/purchases/new") === true`, `canUsePage("cashier", "/purchases") === false`, manager and owner nav orders as above, cashier nav unchanged.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(2d): purchases and reports for managers`.

### Task 6: Purchases list and suppliers

**Files:** Create `app/(dashboard)/purchases/page.tsx`, `app/(dashboard)/purchases/suppliers/[id]/page.tsx`, `components/purchasing/purchases-workspace.tsx`, `components/purchasing/supplier-form.tsx`, `components/purchasing/supplier-page.tsx`; modify `app/globals.css`, `components/icons.tsx` (a Truck/Package icon from hugeicons if none fits).

**Interfaces — Consumes:** Task 4 client, `periodRange` (`lib/profit/math.ts`), `purchasesCsv`, `useEntitlement().hasFeature("purchasing")`, `useShopContext().mode` (hosted only).

- [ ] **Step 1:** Workspace with tabs "Deliveries" and "Suppliers" (`?tab=suppliers`). Starter → Pro card with the fixed copy and the Settings → Billing link. Offline → "Purchases need a connection".
- [ ] **Step 2:** Deliveries tab: period chips + supplier select, table per spec §5.2 (rows link to `/purchases/[id]`), "Voided" badge, "Download CSV", "Record delivery" → `/purchases/new`.
- [ ] **Step 3:** Suppliers tab: search, "Show archived", add/edit dialog (`SupplierForm`, client-made uuid), archive/restore; supplier page with details and its deliveries (this month and last 90 days totals from `listReceipts`).
- [ ] **Step 4:** `tsc` + lint clean; commit `feat(2d): purchases list and suppliers`.

### Task 7: Record a delivery and the delivery page

**Files:** Create `app/(dashboard)/purchases/new/page.tsx`, `app/(dashboard)/purchases/[id]/page.tsx`, `components/purchasing/record-delivery.tsx`, `components/purchasing/delivery-detail.tsx`; modify `app/globals.css`.

**Interfaces — Consumes:** Tasks 3–4; products and stock from `useDemoProducts()`; costs from `useProductCosts(true)` (2C); `refreshSnapshot()` from `lib/demo-store.ts`.

- [ ] **Step 1:** Record page: supplier picker with "New supplier" inline (name only, saved via `saveSupplier`), invoice no., invoice date (`defaultInvoiceDate`), one search/scan box adding through `mergeLines` (Enter on an exact barcode/SKU adds; unknown code shows "No product with code …"), editable quantity and unit cost per line (prefilled from the product's cost, else blank → required), remove line, totals with editable VAT, per-line "Cost a → b" from `costPreview(stock, cost, qty, unit)`, `validateDraft` before Save. The draft id is made once when the page opens and reused on every Save attempt. On success: `refreshSnapshot()`, then show the saved delivery with "Record another" (new id) and "View delivery".
- [ ] **Step 2:** Delivery page: header, lines with cost before/after, "Void delivery" (reason textarea, confirm), refusal messages inline; voided shows the reason and who.
- [ ] **Step 3:** `tsc` + lint clean; commit `feat(2d): record and void deliveries`.

### Task 8: Product form and stock hint

**Files:** Modify `components/catalogue/product-form.tsx`, `components/inventory-workspace.tsx`.

**Interfaces — Consumes:** `lastDeliveries()`.

- [ ] **Step 1:** Inventory loads `lastDeliveries()` when `costAccess(...).canSee && hasFeature("purchasing")` and passes the product's entry to the form; the form shows "Last delivered: {d MMM} · {supplier} · {AED} excl. VAT" under the cost field.
- [ ] **Step 2:** Adjust stock dialog: when "Stock in" is chosen show "For supplier deliveries, use Purchases → Record delivery." (with a link when the shop has `purchasing`).
- [ ] **Step 3:** `tsc` + lint clean; commit `feat(2d): last delivery on the product and stock-in hint`.

### Task 9: Release notes and full verification

**Files:** Modify `docs/RELEASE_CHECKLIST.md`; create `docs/superpowers/plans/2026-11-11-stage-2d-ledger.md`.

- [ ] **Step 1:** Checklist "Stage 2D": apply 057, 058 (safe before the app); deploy after 058; smoke test (supplier, scanned delivery, stock and cost on Inventory, Profit margin, void, duplicate invoice, manager on own device opens Purchases and Reports, cashier no Purchases, Starter Pro card); support note on the average ignoring unsynced till sales.
- [ ] **Step 2:** `npm test`, `npm run test:sql`, `npm run lint`, `npm run typecheck` (known `PageProps` only), `npm run build` → pass.
- [ ] **Step 3:** Browser pass per spec §8 on a worktree dev server (see Global Constraints), local Pro shop.
- [ ] **Step 4:** Ledger (rulings, deferred minors, evidence); commit `docs(2d): release checklist and ledger`.
