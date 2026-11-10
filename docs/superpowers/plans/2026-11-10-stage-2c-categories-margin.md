# Stage 2C Categories and Margin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flat product categories for every shop, and for Pro shops a cost price (hidden from cashiers), cost stamped on
each synced sale line, and a server-built Profit tab.

**Architecture:** Categories are a new table synced through the offline outbox like products. Cost lives in
column-revoked columns that only security-definer functions read. The 2B sync wrappers stamp each line's cost when a
sale or refund syncs. `profit_report` aggregates stamped lines for an owner or manager, served by an online-only API
route.

**Tech Stack:** Next.js 16 app router (read `node_modules/next/dist/docs/` before writing routes), Supabase Postgres
(RLS, security definer, column privileges), zod, `node --test` with `--experimental-strip-types`, `npm run test:sql`.

**Spec:** `docs/superpowers/specs/2026-11-10-stage-2c-categories-margin-design.md`

## Global Constraints

- Feature key `categories_margin` gates cost and profit only; categories work on every plan.
- Cost is excl. VAT, `bigint` fils, `0 ≤ cost ≤ 100000000`; null = no cost.
- Cost and profit: owner and manager only. The till and every cashier view never show them. Cost is never written to IndexedDB.
- Category name: trimmed, 1–40 characters, unique per shop (case-insensitive) among live categories.
- Report range: `0 ≤ to − from ≤ 91` days, Dubai business dates; margin = profit ÷ costed net × 100, one decimal, null when costed net is 0.
- Refusal codes (P0001 unless noted): `not_authorized` (42501), `feature_not_in_plan`, `product_not_found`, `invalid_cost`, `category_name_taken`, `category_not_found`, `invalid_category`, `invalid_range`.
- Migration files: `202611100053_categories.sql`, `202611100054_product_cost.sql`, `202611100055_sync_cost_stamp.sql`. Never edit 001–052.
- Local Supabase only for tests (worktree `.env.local` is local keys only). Start the shared stack from a live checkout (see memory: one stack for all worktrees).
- Files with CRLF line endings: keep CRLF when editing.
- Node unit tests import project files with relative `.ts` paths, not `@/`.
- Copy strings fixed by the spec: "Uncategorised", "Below cost", "Cost needs a connection", "Profit counts synced sales only", "Profit needs a connection", "See profit by day, category and product on Pro", "Cost is a Pro feature and was skipped", "A category with this name already exists".

## Review Focus

1. **A category and a product that uses it, both made offline** → the product must not be refused with `category_not_found`; category operations sync before product operations (Task 4 test `syncOrder puts category ops before products`).
2. **Refunding a sale recorded before 055** (`unit_cost_fils` null) → the refund line stays uncosted and the report shows no negative cost (Task 3 SQL test `refund of uncosted sale stays uncosted`).
3. **Setting a cost on a product just created on this till** → its product operation may not have reached the server; the cost save syncs first and on `product_not_found` says "Saved. The cost will save once this product has synced; open it again to retry." (Task 6 test, Task 7 copy).
4. **This week / last month across a month or year boundary in Dubai time** (e.g. 2026-12-31 22:00 UTC is 2027-01-01 in Dubai) → ranges follow Dubai dates, weeks start Monday (Task 5 tests).
5. **A device whose saved local state predates 2C** (no `categories` key) → loads with `categories: []`, no crash (Task 4 test `normalizeState defaults categories`).

---

### Task 1: Categories migration (053)

**Files:**
- Create: `supabase/migrations/202611100053_categories.sql`
- Create: `supabase/tests/categories_margin_test.sql` (categories part; Tasks 2–3 append)

**Interfaces:**
- Produces: table `product_categories(id, business_id, name, sort_order, created_at, archived_at)`; `products.category_id`; `apply_category_sync(p_operation_id uuid, p_business_id uuid, p_entity_id uuid, p_payload jsonb) returns jsonb`; `apply_product_sync` accepting `product.categoryId`.

- [ ] **Step 1: Write the failing SQL tests** in `categories_margin_test.sql`, in the style of `split_payment_test.sql` (own fixture business, owner and cashier users, `set local role authenticated` + `request.jwt.claims`):
  - `apply_category_sync` with payload `{"category":{"name":" Drinks ","sortOrder":1,"archived":false}}` creates row with name `Drinks`; the same operation id again returns without a second row.
  - A second category named `drinks` (new id) raises `category_name_taken`; after archiving the first, it succeeds.
  - Name `''` or 41 characters raises `invalid_category`.
  - Cashier calling `apply_category_sync` gets `42501`.
  - Cashier `select name from product_categories` returns the shop's rows; a member of another shop sees none.
  - `apply_product_sync` with `categoryId` of another shop's category raises `category_not_found`; with own category sets `products.category_id`; with `categoryId` absent leaves it unchanged; with `null` clears it.
- [ ] **Step 2: Run** `npm run test:sql` → categories test FAILS (function missing).
- [ ] **Step 3: Write migration 053.** Table, partial unique index `(business_id, lower(name)) where archived_at is null`, RLS select policy `has_role(business_id, 'cashier')`, revoke insert/update/delete from `authenticated`. `apply_category_sync` copies the idempotency and owner check pattern of `apply_product_sync` (`202610180020_catalogue_sync.sql`) and records `sync_operations`. Add refusal `invalid_category` for a bad name. `create or replace apply_product_sync` from its latest body (search later migrations for a newer definition first) adding the `categoryId` handling: key absent → keep, null → clear, else must match `product_categories` of `p_business_id`.
- [ ] **Step 4: Run** `supabase migration up` locally, then `npm run test:sql` → PASS (foundation, staff_pins, split_payment, founding_50 still PASS).
- [ ] **Step 5: Commit** `feat(2c): product categories table and sync`.

### Task 2: Cost columns and functions (054)

**Files:**
- Create: `supabase/migrations/202611100054_product_cost.sql`
- Modify: `supabase/tests/categories_margin_test.sql`

**Interfaces:**
- Produces: `products.cost_fils`, `sale_items.unit_cost_fils`, `credit_note_items.unit_cost_fils`; `set_product_cost(p_business_id uuid, p_product_id uuid, p_cost_fils bigint) returns void`; `product_costs(p_business_id uuid) returns table(product_id uuid, cost_fils bigint)`; SQL helper `cost_reader_check(p_business_id uuid)` (raises unless owner/manager and `categories_margin`).

- [ ] **Step 1: Append failing tests:**
  - Cashier `select cost_fils from products` raises `42501` (permission denied); `select id, name, price_fils from products` still works; same for `unit_cost_fils` on `sale_items` and `credit_note_items`.
  - Run the exact column lists used by `app/api/v1/snapshot/route.ts` for products, sales→sale_items and credit_notes→credit_note_items as the cashier: no error.
  - Owner on Pro: `set_product_cost(shop, p, 1250)` then `product_costs(shop)` returns `(p, 1250)`; an `audit_events` row `product.cost` with summary `{"before":null,"after":1250}`.
  - `set_product_cost(shop, p, null)` clears it; `-1` and `100000001` raise `invalid_cost`; another shop's product raises `product_not_found`.
  - Manager: `product_costs` allowed, `set_product_cost` raises `42501`. Cashier: both `42501`.
  - Shop on Starter (no grant, plan starter): both raise `feature_not_in_plan`.
- [ ] **Step 2: Run** `npm run test:sql` → FAIL.
- [ ] **Step 3: Write migration 054.** Add columns with checks. For each of the three tables: `revoke select on table … from authenticated, anon;` then `grant select (<every column except the cost column>) on … to authenticated;` — list columns from the live schema at write time (include 2A/2B columns such as `list_unit_gross_fils`, `operator_member_id`). Functions `security definer set search_path = public, extensions, pg_temp`; feature check via `entitlements_internal(p_business_id) -> 'features' ? 'categories_margin'` as in `202611080045_staff_functions.sql:250`; grant execute to `authenticated` only.
- [ ] **Step 4: Run** `npm run test:sql` → PASS; `npm test` still passes; start the app locally, load `/sale` and `/inventory` as owner and as a cashier account: no PostgREST permission errors in the network panel.
- [ ] **Step 5: Commit** `feat(2c): product cost hidden from cashiers`.

### Task 3: Stamp cost on sync and profit report (055)

**Files:**
- Create: `supabase/migrations/202611100055_sync_cost_stamp.sql`
- Modify: `supabase/tests/categories_margin_test.sql`

**Interfaces:**
- Consumes: Task 2 columns and `cost_reader_check`.
- Produces: replaced `apply_sale_sync_with_payments(p_operation_id, p_business_id, p_entity_id, p_payload)` and `apply_credit_note_sync_with_payments(...)` (same signatures as 051); `profit_report(p_business_id uuid, p_from date, p_to date) returns jsonb` with the shape in spec §4.4 (keys exactly: `totals{netFils,costedNetFils,costFils,profitFils,marginPct,uncostedNetFils,uncostedLines}`, `byDay[{date,netFils,costFils,profitFils}]`, `byCategory[{categoryId,name,netFils,costFils,profitFils,marginPct}]`, `byProduct[{productId,name,quantity,netFils,costFils,profitFils,marginPct}]`).

- [ ] **Step 1: Append failing tests** (fixture: product A cost 1000, product B no cost, category Drinks on A):
  - Sync sale: 2×A (net 2 × 1905) + 1×B → A's line `unit_cost_fils = 1000`, B's null.
  - Change A's cost to 1500, sync a second sale of A → first sale still 1000, second 1500.
  - Re-run the first sale's operation id → stamps unchanged.
  - Refund one A from the first sale → credit note line `unit_cost_fils = 1000`.
  - `refund of uncosted sale stays uncosted`: sale stamped null (insert before setting cost), refund → null; report `costFils` never negative.
  - `profit_report(shop, d, d)`: `totals.costFils` = 2×1000 + 1500 − 1000; `profitFils` = costed net − cost; `uncostedLines = 1`; `uncostedNetFils` = B's net; `marginPct` one decimal; `byCategory` has `Drinks` and `Uncategorised` (`categoryId` null); archived Drinks → its rows move to Uncategorised.
  - 51 costed products → `byProduct` has 50 rows plus `{productId:null,name:"Rest"}`.
  - Range of 92 days → `invalid_range`; `p_to < p_from` → `invalid_range`.
  - Manager allowed; cashier `42501`; Starter `feature_not_in_plan`.
- [ ] **Step 2: Run** `npm run test:sql` → FAIL.
- [ ] **Step 3: Write migration 055.** Recreate both wrappers from 051's bodies. Stamp only when the inner call inserted the document (the existing "rows exist → retry" branch skips stamping). Sale stamp: `update sale_items si set unit_cost_fils = p.cost_fils from products p where si.sale_id = … and p.id = si.product_id`. Credit note stamp: from `sale_items` via `credit_note_items.sale_item_id`. `profit_report`: call `cost_reader_check`, validate range, build from a CTE of signed lines (sales `+`, credit notes `−`) with Dubai date (`(created_at at time zone 'Asia/Dubai')::date` for credit notes, `supply_date` for sales), category via `products.category_id` joined to live categories only.
- [ ] **Step 4: Run** `npm run test:sql` → all PASS.
- [ ] **Step 5: Commit** `feat(2c): stamp cost on synced lines and profit report`.

### Task 4: Categories in the client store and sync

**Files:**
- Modify: `lib/domain.ts` (types), `lib/demo-store.ts` (state, actions, `normalizeState`, `productRecord`), `lib/store/product-sync.ts` (`syncOrder`), `lib/sync/request-schema.ts`, `app/api/v1/sync/route.ts`, `app/api/v1/snapshot/route.ts`, `lib/snapshot/types.ts`, `lib/snapshot/map-rows.ts`
- Test: `tests/categories.test.mjs`, additions to `tests/product-sync.test.mjs`, `tests/snapshot-map.test.mjs`, `tests/sync-request.test.mjs`

**Interfaces:**
- Produces: `type Category = { id: string; name: string; sortOrder: number; archived: boolean }`; `Product.categoryId?: string | null`; `DemoState.categories: Category[]`; `SyncOperation.entity` adds `"category"`; `CategorySyncPayload = { category: Category }`; in `demo-store.ts`: `addCategory(name: string): { ok: true; category: Category } | { ok: false; error: string }`, `renameCategory(id, name)`, `moveCategory(id, direction: -1 | 1)`, `setCategoryArchived(id, archived: boolean)` (each `{ ok: true } | { ok: false; error: string }`), `productsInCategory(id): number`; `ProductPatch` adds `categoryId`; pure helper in `lib/catalogue/categories.ts`: `validCategoryName(name: string, existing: Category[], selfId?: string): string | null` (error text or null), `liveCategories(categories: Category[]): Category[]` (sorted by `sortOrder`, then name).

- [ ] **Step 1: Write failing tests:**
  - `validCategoryName("  ", [])` → `"Enter a category name."`; 41 chars → `"Use at most 40 characters."`; `"drinks"` against live `Drinks` → `"A category with this name already exists"`; against archived `Drinks` → null; renaming self → null.
  - `liveCategories` drops archived and orders by `sortOrder` then name.
  - `syncOrder puts category ops before products`: product op created before a category op it doesn't reference still keeps order; a product op whose payload `categoryId` matches a later-created pending category op sorts after that category op.
  - `normalizeState defaults categories`: `normalizeState({ products: [] })` has `categories: []`.
  - Request schema accepts `{ entity: "category", payload: { category: { id, name: "Drinks", sortOrder: 0, archived: false }, deviceId } }`, rejects a 41-char name, and product records accept `categoryId: null` and a uuid.
  - `mapSnapshotRows` maps `categories` rows `{ id, name, sort_order, archived_at }` to `Category` (archived = `archived_at !== null`) and `products[].category_id` to `categoryId`.
- [ ] **Step 2: Run** `npm test` → new tests FAIL.
- [ ] **Step 3: Implement.** Category ops go through `enqueueInOrder` like products and supersede older pending ops for the same category (mirror `supersedeProductOperations`). In `syncOrder`, rank a category op ahead of any pending product op that references it (same approach as products ahead of stock). Sync route: `entity === "category"` → target id `payload.category.id`, function `apply_category_sync`; `productSyncProblems` shows `category_name_taken` as "A category with this name already exists". Snapshot route selects `product_categories(id, name, sort_order, archived_at)` for every member and adds `category_id` to the products select.
- [ ] **Step 4: Run** `npm test` → PASS; `npm run lint` clean.
- [ ] **Step 5: Commit** `feat(2c): categories in the offline store and sync`.

### Task 5: Profit helpers

**Files:**
- Create: `lib/profit/math.ts`
- Test: `tests/profit-math.test.mjs`

**Interfaces:**
- Produces: `priceExVatFils(priceFils: number, taxCategory: TaxCategory): number` (uses `splitVatInclusive` from `lib/fiscal/countries.ts`); `marginPct(netFils: number, costFils: number): number | null` (one decimal, null when net ≤ 0); `isBelowCost(product: { priceFils: number; taxCategory: TaxCategory }, costFils: number | null): boolean`; `type PeriodKey = "today" | "yesterday" | "this-week" | "this-month" | "last-month"`; `periodRange(key: PeriodKey, now: Date): { from: string; to: string }` (Dubai `YYYY-MM-DD`, reuse `uaeBusinessDate` from `lib/reporting.ts`); `MAX_HISTORY_DAYS = 90`.

- [ ] **Step 1: Write failing tests:**
  - `priceExVatFils(2100, "standard")` → 2000; `(2100, "zero")` → 2100; `(2100, "exempt")` → 2100.
  - `marginPct(2000, 1500)` → 25; `(3000, 1000)` → 66.7; `(0, 0)` → null; `(1000, 1500)` → −50.
  - `isBelowCost({priceFils:2100,taxCategory:"standard"}, 2001)` → true; `2000` → false; `null` → false.
  - `periodRange("this-week", new Date("2026-11-11T08:00:00Z"))` (Wednesday) → `{from:"2026-11-09",to:"2026-11-11"}`.
  - `periodRange("today", new Date("2026-12-31T22:00:00Z"))` → `2027-01-01` both ends.
  - `periodRange("last-month", new Date("2027-01-01T01:00:00Z"))` → `{from:"2026-12-01",to:"2026-12-31"}`.
  - `periodRange("this-week", new Date("2026-11-09T21:00:00Z"))` (Tuesday 01:00 Dubai) → from `2026-11-09`.
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement** in `lib/profit/math.ts` (date math on `YYYY-MM-DD` strings via `Date.UTC`, no local time zone).
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(2c): margin and period helpers`.

### Task 6: Cost and profit API routes

**Files:**
- Create: `lib/profit/route.ts` (server helpers), `app/api/v1/products/costs/route.ts` (GET), `app/api/v1/products/[id]/cost/route.ts` (PUT), `app/api/v1/reports/profit/route.ts` (GET), `lib/profit/client.ts` (browser fetchers), `lib/profit/errors.ts`
- Test: `tests/profit-errors.test.mjs`, `tests/profit-client.test.mjs`

**Interfaces:**
- Consumes: `staffSession()`, `readJson()` from `lib/staff/route.ts`; SQL functions from Tasks 2–3.
- Produces:
  - `GET /api/v1/products/costs` → `{ costs: { productId: string; costFils: number }[] }`
  - `PUT /api/v1/products/{id}/cost` body `{ costFils: number | null }` → `204`
  - `GET /api/v1/reports/profit?from=YYYY-MM-DD&to=YYYY-MM-DD` → the `profit_report` jsonb
  - Errors: `{ error: string, code: string }`, status 403 for `not_authorized`/`feature_not_in_plan`, 404 `product_not_found`, 400 others, 500 unknown. All responses `Cache-Control: no-store`.
  - `profitErrorMessage(code: string): string` in `errors.ts`: `feature_not_in_plan` → "Cost and profit are on the Pro plan.", `not_authorized` → "Only the owner or a manager can see cost and profit.", `product_not_found` → "Saved. The cost will save once this product has synced; open it again to retry.", `invalid_cost` → "Enter a cost between 0 and 1,000,000 AED.", `invalid_range` → "Choose a period within 92 days."
  - In `client.ts`: `fetchProductCosts(): Promise<Map<string, number>>`, `saveProductCost(productId: string, costFils: number | null): Promise<{ ok: true } | { ok: false; error: string }>` (calls `reconcilePendingOperations()` first so a just-created product reaches the server), `fetchProfitReport(from: string, to: string): Promise<{ ok: true; report: ProfitReport } | { ok: false; error: string; offline?: boolean }>`; `type ProfitReport` mirroring Task 3's shape.
- [ ] **Step 1: Write failing tests:** every code above maps to its exact message; an unknown code → "Something went wrong. Try again."; `saveProductCost` with a stubbed `fetch` returning `{code:"product_not_found"}` resolves `{ok:false,error:"Saved. The cost will save once this product has synced; open it again to retry."}`; `fetchProfitReport` with `fetch` throwing `TypeError` resolves `{ ok:false, offline:true, error:"Profit needs a connection" }`.
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement.** Validate `id` with `MEMBER_ID` (uuid regex), dates with `/^\d{4}-\d{2}-\d{2}$/`, `costFils` integer or null via zod. Map rpc error `42501` → `not_authorized`, P0001 message → code. To make `client.ts` testable, take `fetch` and `reconcile` as optional injected parameters (default to the globals).
- [ ] **Step 4: Run** `npm test` → PASS. Manual: with local dev server as Pro owner, `curl`-equivalent in the browser console: `PUT` a cost then `GET` costs returns it; as a cashier account `GET` costs → 403.
- [ ] **Step 5: Commit** `feat(2c): cost and profit API routes`.

### Task 7: Products page — categories, cost, margin

**Files:**
- Create: `components/catalogue/categories-panel.tsx`, `components/catalogue/use-product-costs.ts`
- Modify: `components/catalogue/product-form.tsx`, `components/inventory-workspace.tsx`, `app/globals.css`

**Interfaces:**
- Consumes: Task 4 store actions and `liveCategories`; Task 5 `marginPct`, `priceExVatFils`, `isBelowCost`; Task 6 `fetchProductCosts`, `saveProductCost`; `useEntitlement().hasFeature("categories_margin")`; `useEffectiveRole()`; `useShopContext().role`.
- Produces: `useProductCosts(enabled: boolean): { costs: Map<string, number> | null; loading: boolean; error: string; reload(): void; set(productId: string, costFils: number | null): void }` (memory only).
- [ ] **Step 1: Implement `CategoriesPanel`** (owner + `canWrite`): list live categories with rename, up/down, archive; "Show archived" toggle with restore. Archive with products asks `window.confirm(\`${n} products will show as Uncategorised.\`)`-style dialog using the app's existing confirm pattern. Opens from a "Categories" button in the inventory toolbar.
- [ ] **Step 2: Product form.** Category `<select>` ("No category" + live categories) on every plan. When `canSeeCost = hasFeature("categories_margin") && (effective role is owner or manager)`: "Cost (excl. VAT)" input (owner editable; manager read-only), "Margin x%" under the price (from `priceExVatFils` and cost), "Below cost" tag. Offline (`navigator.onLine === false`): cost input disabled with hint "Cost needs a connection". On save: product through the store as today; if cost changed, `saveProductCost`; a failure shows inline under the cost field and leaves the dialog's product saved.
- [ ] **Step 3: Product list.** Category filter select and Category column (archived/missing → "Uncategorised") for everyone. With `canSeeCost`: Cost and Margin columns, "No cost" filter chip, "Below cost" tag in the name cell. Costs from `useProductCosts(canSeeCost)`; while loading show "—".
- [ ] **Step 4: Verify in browser** (local dev, Pro owner): add Drinks and Snacks, reorder, archive Snacks with a product in it (confirm text shows the count), set a product's cost to 15.00 at price 21.00 standard → "Margin 25.0%"; set cost 25.00 → "Below cost"; go offline (DevTools) → cost field disabled with "Cost needs a connection". As manager PIN: cost read-only. As cashier PIN: no cost column, no cost field. `npm run lint` clean.
- [ ] **Step 5: Commit** `feat(2c): categories and cost on the products page`.

### Task 8: Category chips on the till

**Files:**
- Modify: `components/pos-workspace.tsx`, `app/globals.css`
- Test: `tests/categories.test.mjs`

**Interfaces:**
- Consumes: `liveCategories`; `Product.categoryId`.
- Produces: `filterByCategory(products: Product[], categoryId: string | "all", query: string): Product[]` in `lib/catalogue/categories.ts` — a non-empty `query` ignores the chip.
- [ ] **Step 1: Failing test:** with products A (Drinks), B (none): `filterByCategory(ps, drinksId, "")` → [A]; `filterByCategory(ps, drinksId, "b")` → whatever the existing search returns for "b" (B included); `"all"` → both.
- [ ] **Step 2: Run** `npm test` → FAIL; **implement**; run → PASS.
- [ ] **Step 3: Till UI.** Chip row (`role="radiogroup"`, "All" first) above `.product-grid`, hidden when the shop has no live categories; feeds `availableProducts` through `filterByCategory`. No cost anywhere.
- [ ] **Step 4: Verify in browser** with the network off: chips filter; typing a search shows matches from all categories.
- [ ] **Step 5: Commit** `feat(2c): category chips on the till`.

### Task 9: Profit tab in Reports

**Files:**
- Create: `components/reports/profit-tab.tsx`, `lib/profit/csv.ts`
- Modify: `components/reports-workspace.tsx`, `app/globals.css`
- Test: `tests/profit-csv.test.mjs`

**Interfaces:**
- Consumes: `periodRange`, `MAX_HISTORY_DAYS`, `fetchProfitReport`, `ProfitReport`; `safeCsv` (export it from `lib/reporting.ts`).
- Produces: `profitCsv(kind: "day" | "category" | "product", report: ProfitReport): string` with headings `day`: "Date","Net AED","Cost AED","Profit AED"; `category`: "Category","Net AED","Cost AED","Profit AED","Margin %"; `product`: "Product","Quantity","Net AED","Cost AED","Profit AED","Margin %".
- [ ] **Step 1: Failing test:** `profitCsv("category", r)` first line equals the headings above quoted; amounts as `12.50`; null margin as empty; a name starting with `=` is prefixed `'`.
- [ ] **Step 2: Run** `npm test` → FAIL; **implement**; run → PASS.
- [ ] **Step 3: Tab UI.** Reports gets tabs "Daily" (existing view unchanged) and "Profit". Profit tab hidden when effective role is cashier. Without `categories_margin`: locked card "See profit by day, category and product on Pro" with the existing upgrade button (see `components/billing/feature-gate.tsx`). With it: period chips (Today, Yesterday, This week, This month, Last month) and a date input limited to the last 90 days; headline (Net sales excl. VAT, Cost, Gross profit, Margin %); profit-by-day bars when the range is over one day (CSS bars, no chart library); sortable category and product tables (profit, margin, net); CSV buttons per table; uncosted banner "N sold lines have no cost, so AED X of sales is left out of profit. Add costs in Products." linking to `/inventory?filter=no-cost` (Task 7 filter reads this param); note "Profit counts synced sales only" when pending sale or credit-note ops exist; offline → "Profit needs a connection".
- [ ] **Step 4: Verify in browser:** Pro owner sells two costed items and one uncosted → after sync the tab's totals match `profit_report` called from SQL; banner shows 1 line; This week/This month switch; CSV downloads open in a spreadsheet. Manager sees the tab; cashier PIN does not; Starter sees the locked card.
- [ ] **Step 5: Commit** `feat(2c): profit tab in reports`.

### Task 10: Category and cost in CSV import

**Files:**
- Modify: `lib/catalogue/types.ts` (`ImportField` adds `"category" | "cost"`), `lib/catalogue/columns.ts` (guess headings `category`, `cost`, `cost price`, `cost (aed)`), `lib/catalogue/classify.ts`, `lib/demo-store.ts` (`applyImport`), `components/catalogue/import-dialog.tsx`
- Test: `tests/catalogue-classify.test.mjs`

**Interfaces:**
- Consumes: Task 4 `addCategory` semantics; Task 6 `saveProductCost`.
- Produces: `ProductDraft` and `PlannedUpdate.after` gain `categoryName?: string` and `costFils?: number | null`; `ImportPlan.newCategories: string[]`; `planImport` option `costAllowed: boolean`; `ImportPlan.costSkipped: boolean`.
- [ ] **Step 1: Failing tests:** a row with `Category = "Snacks"` (not existing) → `plan.newCategories = ["Snacks"]` once for many rows, case-insensitive match to an existing live category reuses it; `Cost = "12.5"` → `costFils 1250`; `Cost = "-1"` and `"abc"` → problem reason "Cost must be a number from 0 to 1,000,000."; `costAllowed:false` with a cost column → costs dropped and `costSkipped: true`; category over 40 chars → problem reason "Category names can be at most 40 characters."
- [ ] **Step 2: Run** `npm test` → FAIL; **implement**; run → PASS.
- [ ] **Step 3: Apply and UI.** `applyImport` creates `newCategories` first (category ops enqueue before product ops) and sets `categoryId` on creates and updates (a category change counts as a product change). After the store save, the dialog posts costs one by one with `saveProductCost` and reports "Costs saved for N products" or the first error. Preview shows "New categories: …" and, when `costSkipped`, "Cost is a Pro feature and was skipped". `EXPORT_HEADINGS` adds "Category" (export only; cost is never exported from the product list).
- [ ] **Step 4: Verify in browser:** import a 5-row CSV with category and cost on Pro → categories created, costs visible in the list; same file on Starter → preview shows the skip line, products import, no cost calls.
- [ ] **Step 5: Commit** `feat(2c): category and cost columns in import`.

### Task 11: Release notes and full verification

**Files:**
- Modify: `docs/RELEASE_CHECKLIST.md` (add "Stage 2C" section after 2B)
- Create: `docs/superpowers/plans/2026-11-10-stage-2c-ledger.md`

- [ ] **Step 1: Release checklist section:** apply 053, 054, 055 in order before the app; before 054 confirm no deployed code selects `*` from `products`, `sale_items`, `credit_note_items` as a member; deploy 2C after 055; smoke test (Pro owner: categories, cost, sell, Profit tab; manager read-only; cashier PIN sees no cost; Starter locked card; till chips offline); support note: past sales before 2C have no cost.
- [ ] **Step 2: Run everything:** `npm test`, `npm run test:sql`, `npm run lint`, `npm run typecheck` (known fresh-checkout `PageProps` errors only), `npm run build` → all pass.
- [ ] **Step 3: Offline production-build run** (as in 2B ledger): with the local API gateway stopped, create a category and a product in it and sell it; reconnect, Sync now → category, product and sale accepted; the sale line is stamped with the product's cost; Profit tab shows it.
- [ ] **Step 4: Write the ledger** (decisions that differ from the plan, deferred minors, evidence) and commit `docs(2c): release checklist and ledger`.
