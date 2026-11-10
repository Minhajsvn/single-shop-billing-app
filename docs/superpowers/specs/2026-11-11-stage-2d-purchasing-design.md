# Stage 2D: Suppliers and deliveries — design

Date: 2026-11-11. Fourth sub-project of Stage 2 (Pro tier). Order: 2A staff and PINs → 2B split payment → 2C categories
and margin (all merged) → **2D** → 2E promotions → 2F weighed items → 2G serial/IMEI → 2H advanced reports → 2I digital
receipts.

## 1. Goal

A Pro shop keeps a list of its suppliers and records each delivery once, from the supplier's invoice. Recording it adds
the stock and updates each product's cost, so the 2C profit figures stay right without typing costs by hand, and the
accountant gets a list of purchases with their input VAT.

Success:
- An owner or manager records a 12-line delivery by scanning barcodes in under three minutes.
- After saving, Inventory shows the new stock and the new average cost; the Profit tab uses that cost for later sales.
- A mistaken delivery is voided in two clicks, with its stock taken back out.
- The accountant downloads one CSV of purchases with supplier TRN, invoice number, net, VAT and gross.

## 2. Owner decisions (from the conversation)

1. **Scope:** record deliveries (with a supplier list and purchase history). No purchase orders sent to suppliers and no
   supplier balances or payments in 2D.
2. **Cost update:** weighted average: (stock on hand × old cost + quantity received × new unit cost) ÷ (stock on hand +
   quantity received). The owner can still set a cost by hand (2C).
3. **VAT:** lines are entered excl. VAT; the delivery keeps the supplier's invoice number, invoice date, the supplier's
   TRN and the invoice's VAT total, and a purchases CSV lists input VAT.
4. **Who:** owner and manager record and void deliveries and manage suppliers. Cashiers never see buying prices.
5. **Approach:** online only. A delivery is saved by one server function; delivery prices never go into a till's
   offline storage.

Assumptions stated and not corrected: the feature is Pro (`purchasing`); voiding reverses stock but not cost; a void is
refused when stock has already gone below what it would take out.

## 3. What already exists

- `stock_movements` (`202608300001_sprint_one_foundation.sql`) with type `receipt` and `correction_out`, `source_id`
  and `operation_id`; "Adjust stock" on Inventory records a `receipt` with a free-text reason.
- 2C: `products.cost_fils` (column-revoked from members), `set_product_cost`, `cost_reader_check(p_business_id)`
  (owner or manager on a plan with `categories_margin`), the Profit tab, `lib/profit/*`.
- `purchasing` is a Pro feature in `lib/billing/plans.ts` and `plan_catalog`, used nowhere yet.
- Navigation: `lib/access/cashier.ts` gives every non-owner the cashier's pages (`isOwnerView`), so a manager signed in
  on their own device cannot open `/reports` today (a 2C gap: the Profit tab is only reachable by a manager behind
  the PIN on the owner's till).

## 4. Data and server

Migration `202611110057_suppliers.sql`:

- Table `suppliers`: `id uuid pk`, `business_id`, `name text` (trimmed, 1–80), `trn text` (null or 15 digits), `phone`
  (≤ 30), `email` (≤ 120), `note` (≤ 300), `created_at`, `archived_at`. Unique `(business_id, lower(name))` where not
  archived.
- RLS on, no table privileges for `anon`/`authenticated`; reads and writes only through functions.
- `purchasing_check(p_business_id uuid)`: raises `42501 not_authorized` unless the caller is owner or manager of the
  shop, and `P0001 feature_not_in_plan` unless the shop has `purchasing`.
- `supplier_list(p_business_id)` returns every supplier (archived flagged); `supplier_save(p_business_id, p_supplier
  jsonb)` upserts by id (client-made uuid), refusing `supplier_name_taken`, `invalid_supplier`, `supplier_not_found`
  (another shop's id). Archive and restore go through `supplier_save` with `archived`.

Migration `202611110058_purchase_receipts.sql`:

- `purchase_receipts`: `id uuid pk` (made by the client), `business_id`, `supplier_id` (not null), `supplier_invoice`
  (null or 1–40), `invoice_date date`, `net_fils`, `vat_fils`, `gross_fils` (= net + vat), `note` (≤ 300),
  `received_by uuid`, `created_at`, `voided_at`, `voided_by`, `void_reason` (1–200 when voided). Unique
  `(business_id, supplier_id, lower(supplier_invoice))` where `supplier_invoice` is not null and not voided.
- `purchase_receipt_lines`: `id`, `receipt_id`, `business_id`, `product_id`, `quantity integer` (1–100000),
  `unit_cost_fils` (0–100000000), `line_net_fils` (= quantity × unit cost), `cost_before_fils`, `cost_after_fils`
  (kept for the history and the audit). Unique `(receipt_id, product_id)`.
- RLS on, no table privileges for members; reads through functions only.
- `record_purchase_receipt(p_business_id, p_receipt jsonb)`:
  - `purchasing_check`; payload `{ id, supplierId, supplierInvoice?, invoiceDate, vatFils, note?, lines: [{ productId,
    quantity, unitCostFils }] }`; 1–200 lines; no product twice (`duplicate_line`).
  - Same `id` already saved for this shop → returns it unchanged (retry). Same id in another shop → `invalid_receipt`.
  - Supplier must be this shop's and live (`supplier_not_found`); each product this shop's and active
    (`product_not_found`, `product_archived`); invoice duplicate → `duplicate_supplier_invoice`.
  - `vat_fils` between 0 and net (`invalid_vat`); net is the sum of line nets computed here.
  - For each line, in product-id order, `select … for update` the product, then: new stock = stock + quantity; new
    cost = round((greatest(stock, 0) × coalesce(cost, unit) + quantity × unit) / (greatest(stock, 0) + quantity));
    insert a `receipt` stock movement (`source_id` = receipt id, reason "Delivery · supplier · invoice");
    store `cost_before_fils`/`cost_after_fils` on the line.
  - Audit `purchase.receipt` (supplier, invoice, lines, totals) and `product.cost` per changed cost with
    `{ before, after, receiptId }`.
- `void_purchase_receipt(p_business_id, p_receipt_id, p_reason)`: `purchasing_check`; refuses `receipt_not_found`,
  `already_voided`, `invalid_reason`; locks the products; if any product's stock < the line quantity →
  `stock_too_low` with the product name; else `correction_out` movements and the voided fields. Cost is not changed.
- Reads: `purchase_receipt_list(p_business_id, p_from date, p_to date, p_supplier uuid default null)` (max 92 days,
  `invalid_range`) returns header rows with supplier name/TRN and line count; `purchase_receipt_get(p_business_id,
  p_id)` returns the header and lines with product names; `product_last_delivery(p_business_id)` returns, per product,
  the latest non-voided delivery's date, supplier name and unit cost.

## 5. Screens

### 5.1 Access

- `lib/access/cashier.ts` gains manager pages: a manager (signed in or behind the PIN) may open `/purchases` and
  `/reports`; cashiers may not. Navigation shows Purchases to owner and manager, after Inventory.
- This also closes the 2C gap: a manager on their own device can open Reports (the Profit tab works server-side;
  the Daily tab shows what that device's snapshot holds).
- Starter: Purchases opens a Pro card ("Record supplier deliveries and keep costs up to date on Pro") with the
  existing Settings → Billing link.

### 5.2 Purchases → Deliveries

- List: date, supplier, invoice no., lines, net, VAT, total, "Voided" badge; period chips (Today … Last month, as 2C)
  and a supplier filter; "Download CSV" for the period.
- "Record delivery" (`/purchases/new`), a full page:
  - Supplier select with search; "New supplier" adds one by name inline.
  - Supplier invoice no. (optional) and invoice date (default today, Dubai).
  - Line entry: one search box (name, SKU or barcode; a scan adds the product, a second scan adds 1 to its line);
    quantity and unit cost excl. VAT per line, unit cost prefilled with the product's current cost.
  - Totals: net (computed), VAT (default round(net × 5%), editable), gross.
  - Each line shows its cost change, e.g. "Cost 5.00 → 5.50", using the same formula as the server on the stock the
    page knows; the server's figures are what is saved.
  - Save sends the client-made id; on success the page refreshes the snapshot, shows the delivery, and offers
    "Record another".
  - Offline: "Recording a delivery needs a connection" and Save disabled; the lines stay on the page (memory only).
- Delivery page (`/purchases/[id]`): header, lines with cost before/after, and "Void delivery" (reason required,
  confirmation).

### 5.3 Purchases → Suppliers

- List with search and "Show archived"; add, edit (name, TRN, phone, email, note), archive and restore.
- Supplier page: details and its deliveries with totals for this month and the last 90 days.

### 5.4 Elsewhere

- Product edit form (owner and manager on Pro): "Last delivered: 9 Nov · Al Noor Trading · AED 5.00 excl. VAT".
- Inventory "Adjust stock" with "Stock in": hint "For supplier deliveries, use Purchases → Record delivery."
- Purchases CSV: one row per delivery, columns "Date", "Supplier", "Supplier TRN", "Invoice no.", "Net AED",
  "VAT AED", "Gross AED", "Voided"; same quoting as the daily report.

## 6. Errors and limits

- Duplicate supplier invoice → "This supplier invoice is already recorded on {date}." with a link to it.
- Repeated product in the form → merged into one line before sending.
- Archived product → "Restore {name} first."; another shop's product or supplier → refused.
- Limits: 200 lines; quantity 1–100,000; unit cost 0–1,000,000 AED (0 allowed for free goods); VAT 0 to net.
- Sales syncing at the same time: products are locked one by one in id order, so stock is never lost. The average uses
  the server's stock, so sales still waiting in a till's outbox are not counted (small, noted for support).
- Void with too little stock → "{name}: only {n} left; record a correction in Inventory instead."
- Leaving Pro: suppliers and deliveries are kept; Purchases locks; stock and costs stay.

## 7. Rollout

1. Apply `202611110057_suppliers` and `202611110058_purchase_receipts`. Nothing existing changes, so they are safe
   before the app deploy.
2. Deploy the 2D app after 058.
3. Plan copy: the Pro feature list says "Suppliers and deliveries".

## 8. Testing

- SQL (`supabase/tests/purchasing_test.sql`):
  - a delivery raises stock and records `receipt` movements with `source_id`
  - weighted average: 10 in stock at 5.00 + 10 at 6.00 → 5.50; no cost yet → takes the new price; stock −3 counts as
    0; cost before/after stored on the line
  - the same id twice saves once; duplicate supplier invoice refused, allowed again after the first is voided
  - void reverses stock and leaves cost; voiding twice refused; too little stock refused
  - cashier refused everywhere; manager allowed; Starter `feature_not_in_plan`; another shop's product/supplier refused
  - 201 lines refused; quantity 0 refused; VAT above net refused; a member cannot select from the new tables
- Unit (`node --test`): line merge, totals and VAT default, the cost preview matches the SQL formula (including
  negative stock and no cost), purchases CSV quoting, the manager page rules.
- Browser: record a delivery by scanning, check stock, cost and the Profit tab margin; void it; duplicate invoice
  refused; manager on their own device records and opens Reports; cashier has no Purchases; Starter sees the Pro
  card; offline notice.

## 9. Out of scope

- Purchase orders sent to suppliers, partial receiving against an order.
- Supplier balances, payments to suppliers, credit notes from suppliers, returns to suppliers.
- Landed costs (freight, duty) spread over lines; multiple currencies.
- Editing a saved delivery (void and record again instead).

## 10. Open items

- None blocking.
