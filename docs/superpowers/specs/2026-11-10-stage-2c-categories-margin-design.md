# Stage 2C: Categories and margin — design

Date: 2026-11-10. Third sub-project of Stage 2 (Pro tier). Order: 2A staff and PINs (merged) → 2B split payment
(merged) → **2C** → 2D suppliers and purchase orders → 2E promotions → 2F weighed items → 2G serial/IMEI → 2H advanced
reports → 2I digital receipts.

## 1. Goal

An owner groups products into categories and records what each product costs, then sees how much profit the shop
made by day, by category and by product. Past profit never changes when a cost is edited later.

Success:
- An owner on Pro enters a cost, sells, and sees that sale's profit and margin on the Profit tab the same day.
- Changing a cost changes the profit of later sales only.
- A cashier never sees a cost or a profit figure, on screen or in data sent to their device.
- Every shop, Starter included, can sort products into categories and filter the till by them, offline.

## 2. Owner decisions (from the conversation)

1. **Main goal:** profit reports (gross profit and margin % by day, product and category).
2. **Cost history:** each sale line keeps the cost at the moment it was recorded; reports for past periods never change.
3. **Categories:** one flat list; a product is in at most one category.
4. **Plans:** categories for every plan; cost price and profit reports are Pro (`categories_margin`). Starter sees a
   locked profit card. Founding 50 shops count as Pro through the existing entitlements.
5. **Who sees cost:** owner and manager. Cashiers never.
6. **Report period:** Today, Yesterday, This week, This month, Last month, or any single day, within the last 90 days.
   Custom ranges and longer views wait for 2H.
7. **Cost entry:** excluding VAT. Profit = selling price excluding VAT − cost.
8. **Approach:** the server stamps cost on each line when a sale syncs, and profit is computed by a server function.
   Cost never reaches a till. The Profit tab needs a connection and counts synced sales only.

## 3. What already exists

- `products` (`202608300001_sprint_one_foundation.sql`) has no category and no cost. "Category" today means only the VAT
  `tax_category` (`standard`, `zero`, `exempt`).
- `categories_margin` is a Pro feature in `lib/billing/plans.ts` and `plan_catalog`, used nowhere yet.
- Members (cashier and up) read `products` through `"members read products"` (`202610210029_cashier_access.sql`);
  only owners write them. Product edits travel through the outbox to `apply_product_sync` (owner only,
  `202610180020_catalogue_sync.sql`).
- Sales sync through `apply_sale_sync_with_payments` and refunds through `apply_credit_note_sync_with_payments`
  (`202611090051_sync_with_payments.sql`), which wrap the older `apply_*_sync` functions.
- `sale_items` and `credit_note_items` store `net_fils`, `vat_fils` and `gross_fils` per line;
  `credit_note_items.sale_item_id` points at the line being returned.
- The till snapshot (`app/api/v1/snapshot/route.ts`) sends products and the owner's last 90 days of sales to the
  device. Reports (`lib/reporting.ts`, `components/reports-workspace.tsx`) are one day at a time, built on the device.
- CSV import: `components/catalogue/import-dialog.tsx`. Product form: `components/catalogue/product-form.tsx`.
- 2A precedent for hiding a column from members: `202611080047_staff_list.sql` (column-level grants plus an
  owner-only function).

## 4. Data and server

### 4.1 Categories (every plan)

Migration `202611100053_categories.sql`:

- Table `product_categories`: `id uuid pk`, `business_id uuid not null` (references `businesses`), `name text not null`
  (trimmed, 1–40 characters), `sort_order integer not null default 0`, `created_at timestamptz not null default now()`,
  `archived_at timestamptz`. Unique index on `(business_id, lower(name))` where `archived_at is null`.
- RLS: members (cashier and up) select; no direct writes for anyone (writes go through the sync function).
- `products.category_id uuid` (nullable) references `product_categories(id)`. A product whose category is archived
  keeps the link but is shown and reported as "Uncategorised".
- `apply_category_sync(p_operation_id, p_business_id, p_entity_id, p_payload)`: owner only, idempotent on the
  operation id like `apply_product_sync`. Payload `{ category: { name, sortOrder, archived } }`; upserts by id. A live
  name clash raises `P0001 category_name_taken`.
- `apply_product_sync` accepts an optional `categoryId` in the product payload. It must be null or a category of the
  same business, else `P0001 category_not_found`.
- The snapshot sends live and archived categories (`id, name, sort_order, archived_at`) and each product's
  `category_id`.

### 4.2 Cost (Pro, owner and manager)

Migration `202611100054_product_cost.sql`:

- `products.cost_fils bigint` (nullable, `>= 0`, `<= 100000000`, i.e. AED 1,000,000), excluding VAT.
- `sale_items.unit_cost_fils bigint` and `credit_note_items.unit_cost_fils bigint`, both nullable and `>= 0`.
- Column privileges: revoke table-wide `select` on `products`, `sale_items` and `credit_note_items` from
  `authenticated`, then grant `select` on every column except the cost columns. The existing RLS policies stay. The
  snapshot and every other app query already name their columns. Check that none selects `*` on these tables.
- `set_product_cost(p_business_id uuid, p_product_id uuid, p_cost_fils bigint)`: security definer; owner only
  (`42501 not_authorized`); shop must have `categories_margin` (`P0001 feature_not_in_plan`); the product must belong to
  the shop (`P0001 product_not_found`); range check (`P0001 invalid_cost`). Null clears the cost. Writes an audit event
  `product.cost` with the cost before and after.
- `product_costs(p_business_id uuid)`: returns `(product_id, cost_fils)` for an owner or manager on a Pro shop.
  Otherwise it refuses as above.

### 4.3 Stamping cost on lines

Migration `202611100055_sync_cost_stamp.sql` replaces the two 2B wrappers in place (same names and arguments, so the
sync route does not change):

- `apply_sale_sync_with_payments`: after the inner sale insert, and only when this call inserted the sale (not a
  retry), set `sale_items.unit_cost_fils = products.cost_fils` for that sale's lines with a product. Lines without a
  product or with no cost stay null.
- `apply_credit_note_sync_with_payments`: likewise, set `credit_note_items.unit_cost_fils` from the referenced
  `sale_items.unit_cost_fils`, so a return takes back exactly the cost that was counted.
- A sale made offline takes the cost at the time it syncs.
- No backfill. Sales recorded before 055 stay uncosted.

### 4.4 Profit report

`profit_report(p_business_id uuid, p_from date, p_to date)` returns jsonb. It runs in the same migration, with the
same owner-or-manager and Pro checks. `p_to - p_from` must be 0–91 days (`P0001 invalid_range`). Dates are Dubai
business dates: sales by `supply_date`, credit notes by their Dubai creation date, as in `buildDailyReport`.

- Line profit = `net_fils − quantity × unit_cost_fils`. Credit note lines subtract their net and cost on the day of the
  refund.
- Lines with a null cost are **uncosted**. Their net goes to `uncostedNetFils` and their count to `uncostedLines`. They
  are left out of cost, profit and margin, so a missing cost never shows as 100% margin.
- Margin % = profit ÷ costed net × 100, one decimal place. Null when costed net is 0.
- Shape:
  `{ totals: { netFils, costedNetFils, costFils, profitFils, marginPct, uncostedNetFils, uncostedLines },
     byDay: [{ date, netFils, costFils, profitFils }],
     byCategory: [{ categoryId | null, name, netFils, costFils, profitFils, marginPct }],
     byProduct: [{ productId | null, name, quantity, netFils, costFils, profitFils, marginPct }] }`
- Category comes from the product's current category, so moving a product moves its history; the cost stays frozen.
  Archived and missing categories group under "Uncategorised".
- `byProduct` lists the top 50 by profit, then one "Rest" row. Lines without a product group by description.

## 5. Screens

### 5.1 Reports → Profit tab

- Shown to owner and manager. Hidden from cashiers, including a PIN cashier on the shared owner sign-in (effective
  role from 2A).
- Starter: a locked card ("See profit by day, category and product on Pro") with the existing upgrade button.
- Period chips: Today, Yesterday, This week (Monday start), This month, Last month; a single-day picker limited to the
  last 90 days. The range goes to `profit_report` through `GET /api/v1/reports/profit?from&to`.
- Headline: net sales (excl. VAT), cost, gross profit, margin %. A small bar chart of profit by day when the range is
  longer than one day. Category and product tables can be sorted by profit, margin or net sales.
- Uncosted banner when `uncostedLines > 0`: "N sold lines have no cost, so AED X of sales is left out of profit. Add
  costs in Products." It links to the product list filtered to "No cost".
- Note "Profit counts synced sales only" when the outbox has pending sales. Offline: "Profit needs a connection".
- CSV export per table, using the existing `safeCsv` rules.

### 5.2 Products

- Categories panel (owner): add, rename, reorder (up/down), archive. Archive asks for confirmation when products use
  the category ("12 products will show as Uncategorised"). It works offline through the outbox.
- Product form: Category select on every plan.
- Pro, owner: "Cost (excl. VAT)" field and a live "Margin x%" read-out under the price. Price excl. VAT is computed with
  the product's tax category. On save, the product goes through the outbox as today, and a changed cost is sent
  online to `set_product_cost`. Offline, the cost field is disabled ("Cost needs a connection") and the rest of the
  form still saves. A cost-save failure shows inline and leaves the product saved.
- "Below cost" tag (form and list) when price excl. VAT < cost.
- Product list: category filter and Category column for everyone. Owner and manager on Pro: Cost and Margin columns
  and a "No cost" filter. Costs load online from `product_costs` on page open and are kept in memory only, never in
  IndexedDB.
- Managers see cost and margin read-only (product editing stays owner-only).

### 5.3 Till

- A row of category chips above the product grid: "All" and then each live category in `sort_order`. Tapping one
  filters the grid. Search ignores the chip and looks across all products. Works offline from the snapshot.
- No cost or margin anywhere on the till.

### 5.4 Import

- CSV import gains optional `category` and `cost` columns.
- An unknown category name is created first. The preview lists "New categories: …" before the owner confirms.
- `cost` (AED, excl. VAT) is applied after the products save, through `set_product_cost`, on Pro only. On Starter the
  column is ignored and the preview says "Cost is a Pro feature and was skipped". Invalid costs are row errors in
  the preview.

## 6. Errors and plan changes

- Duplicate category name → "A category with this name already exists", shown like the SKU clash in the outbox.
- `set_product_cost` refusals map to plain messages: not your shop's product, cost out of range, Pro needed.
- Shop leaves Pro: stored and stamped costs are kept; the Profit tab locks; the cost field and columns are hidden;
  categories keep working.
- Product deleted or archived: its stamped lines still count under its last name.

## 7. Rollout

1. Apply `053_categories`, `054_product_cost` and `055_sync_cost_stamp` in order. They are safe before the app deploy:
   the current app ignores the new columns and calls the same sync function names, and stamping starts when 055 is
   applied.
2. Before applying 054, confirm that no deployed app code selects `*` from `products`, `sale_items` or
   `credit_note_items` as a member. The column revoke would make such a query fail.
3. Deploy the 2C app after 055.

## 8. Testing

- SQL (`supabase/tests/categories_margin_test.sql`):
  - a cashier selecting `cost_fils` or `unit_cost_fils` is refused, and the named-column snapshot queries still work
  - a synced sale stamps the current cost, a later cost change leaves it unchanged, and a retry does not re-stamp
  - a refund copies the cost from its sale line
  - the `profit_report` totals, uncosted numbers, Uncategorised grouping, top-50 + Rest and range limit are right
  - Starter is refused; a manager is allowed; a cashier is refused
  - `apply_category_sync` is idempotent and refuses a duplicate live name
  - `apply_product_sync` refuses another shop's category
- Unit (`node --test`): margin and price-excl-VAT maths with rounding; period chips to date ranges across month ends
  in Dubai time; import parsing for `category` and `cost`; category chip filtering.
- Browser:
  - Pro owner: add categories, set a cost, sell, and check that the Profit tab matches
  - the uncosted banner and the "No cost" filter
  - a manager sees cost and margin read-only
  - a PIN cashier sees no cost or Profit tab
  - Starter sees the locked card and import skips cost
  - the till's category chips work with the network off

## 9. Out of scope

- Subcategories and tags; per-category VAT or pricing rules.
- Average or FIFO costing from purchases (2D will set `cost_fils` from received purchase orders).
- Custom date ranges, year views and comparisons (2H).
- Profit on the till, on receipts or in the daily CSV.

## 10. Open items

- None blocking. Whether the daily report should show a one-line profit figure for owners can be decided after pilot
  feedback.
