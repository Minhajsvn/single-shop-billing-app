# Stage 2F: Weighed items and scale labels — design

Date: 2026-11-13. Sixth sub-project of Stage 2 (Pro tier). Order: 2A staff and PINs → 2B split payment → 2C categories
and margin → 2D suppliers and deliveries → 2E promotions (all merged) → **2F** → 2G serial/IMEI → 2H advanced reports →
2I digital receipts. A till-connected scale is split off into its own later stage, built against a pilot shop's scale.

## 1. Goal

A Pro shop sells loose goods by weight: dates, nuts, sweets, produce, meat. The cashier scans the label a counter scale
printed, or picks the product and types the weight; billo prices it per kg, takes the right grams out of stock, and
prints "0.750 kg × AED 40.00/kg" on the receipt. Costs, deliveries, promotions and profit all work in kg.

Success:
- Scanning a scale label adds the right product, weight and price in under a second, offline too.
- Stock for weighed products is exact to the gram; a refund puts the grams back.
- A delivery of 25.5 kg updates the per-kg average cost; the Profit tab shows kg sold.
- Every existing sale path (non-weighed products, older tills) behaves exactly as today.

## 2. Owner decisions (from the conversation)

1. **Ways in:** scale-printed barcode labels and typed weights now; a till-connected scale is a separate later stage.
2. **Label format:** a shop setting: prefixes (20–29), item-code length (4–6), and whether the value digits hold the
   weight in grams or the price in fils; with a test box.
3. **Storage:** a weighed line is quantity 1 at its total price with a new `weight_grams`; weighed products keep stock in
   grams (integers everywhere).
4. Design parts 1–4 approved as presented (products and storage; labels and till; stock, inventory and reports; rollout
   and testing).

## 3. What already exists

- Quantities are integers everywhere: `sale_items.quantity`, `credit_note_items.quantity`, `products.stock_quantity`,
  `stock_movements.quantity_delta`. `apply_sale_sync` (latest `202610190024_register_access_gate.sql`) requires per
  line `gross = unit × quantity`, unit > 0, and takes `quantity` off stock for product lines;
  `apply_credit_note_sync` (latest `202610130016_tills_and_sync_device.sql`) puts `quantity` back.
- 2C: `products.cost_fils` (column-revoked), cost stamping in the sale wrapper (latest `202611120059_promotions.sql`),
  `profit_report` (`202611100055`). 2D: `record_purchase_receipt` (`202611110058`) with `line_net_fils = quantity ×
  unit_cost_fils`. 2E: `lib/promotions/engine.ts`.
- `apply_product_sync` latest in `202611100053_categories.sql`; product form `components/catalogue/product-form.tsx`;
  barcode lookup in the till (`findByCode`), EAN check in `lib/catalogue/barcode.ts`.
- `weighed_items` is a Pro feature in `lib/billing/plans.ts`, used nowhere yet.

## 4. Data and server

Migration `202611130060_weighed_items.sql`:

- `products.sold_by_weight boolean not null default false`; `products.scale_code integer` (1–999999), unique per shop
  where not null. For weighed products `price_fils` and `cost_fils` are per kg, and `stock_quantity` and
  `low_stock_threshold` are grams.
- `sale_items.weight_grams integer` and `credit_note_items.weight_grams integer` (1–100000, null for other lines);
  member column grants extended (2C column privileges).
- `businesses.scale_label jsonb` default `{"prefixes":["21","22"],"codeLength":5,"value":"weight"}`; validated
  (`prefixes` 1–10 two-digit strings 20–29, `codeLength` 4–6, `value` `weight` or `price`); owner sets it through
  `shop_set_scale_label(p_business_id, p_settings jsonb)` (Pro, `weighed_items`). Sent in the snapshot.
- `apply_product_sync` (replaced): accepts `soldByWeight` and `scaleCode`; turning `sold_by_weight` on or off is
  refused while stock ≠ 0 (`weight_switch_needs_zero_stock`) and on a plan without `weighed_items`
  (`feature_not_in_plan`); a scale code used by another product → `scale_code_taken`.
- `apply_sale_sync` (replaced from its latest body): a line with `weightGrams` must be quantity 1, 1–100000 grams, for a
  `sold_by_weight` product (`weight_mismatch` otherwise); stock moves by `weight_grams` for such lines (the sale
  movement's `quantity_delta` = −grams); the line stores `weight_grams`. Lines without `weightGrams` are unchanged.
- `apply_credit_note_sync` (replaced): a refund line of a weighed sale line returns the whole line (quantity 1) and puts
  its `weight_grams` back; it copies `weight_grams` from the sale line.
- Sale wrapper (replaced from 059): for weighed lines the stamped `unit_cost_fils` = round(cost per kg × grams ÷ 1000);
  promotion copying and the split-cash movement are kept.
- `record_purchase_receipt` (replaced from 058): for a `sold_by_weight` product the line's `quantity` is grams
  (1–100000000) and `unit_cost_fils` is per kg; `line_net_fils` = round(grams × cost ÷ 1000); the weighted average
  uses grams; the 2D table check is replaced by one that allows this for weighed lines (a new column
  `purchase_receipt_lines.by_weight boolean` records which rule applied). `void_purchase_receipt` moves grams.
- `profit_report` (replaced from 055): `byProduct` rows gain `weightGrams` (sum of signed `weight_grams`, null when the
  product had none).

## 5. Scale labels and the till

- `lib/weighing/label.ts`: `parseScaleLabel(code, settings)` → `{ kind: "weight", scaleCode, grams } | { kind: "price",
  scaleCode, priceFils } | { error: "not_scale" | "bad_check_digit" }`. Only 13-digit codes with a configured prefix and
  a valid EAN-13 check digit are labels; value digits = 13 − 2 − codeLength − 1.
- Till lookup order on Enter/scan: an ordinary product barcode or SKU match first; then a scale label; else "No product
  with code …". A label's scale code finds the weighed product by `scaleCode`; none → "No weighed product with scale
  code 01234". A bad check digit → "This label did not scan cleanly; scan again".
- Weight label: price = round(grams × price per kg ÷ 1000), at least 1 fils. Price label: grams = round(price ÷ price
  per kg × 1000), at least 1.
- Typed weight: tapping or searching a weighed product opens a weight box (kg, up to 3 decimals, 0.001–100) with a live
  price; Enter adds the line.
- Cart: each weighed scan or entry is its own line (no merging); no quantity stepper; the line shows "0.750 kg × AED
  40.00/kg". Local stock goes down by grams; the sold-out check uses grams.
- Promotions (2E engine): weighed lines take only `percent_off` and the basket offer; `amount_off` and multi-buys skip
  them.
- Receipt and A4 invoice: "Name · 0.750 kg × AED 40.00/kg" then the line total.
- Settings → Scale labels (owner, Pro): prefixes, code length, weight/price, and a test box that shows the parsed result
  ("Item 01234 → Medjool Dates · 0.750 kg · AED 30.00") or why it failed.

## 6. Inventory and reports

- Weighed products: stock and low-stock shown in kg with 3 decimals; price "AED 40.00 /kg"; product form "Sold by
  weight" switch (disabled with a hint while stock ≠ 0), scale code, price and cost labelled per kg.
- Adjust stock on a weighed product takes kg (3 decimals) and stores grams; movements display kg.
- CSV export/import: "Sold by weight" (yes/no) and "Scale code" columns; weighed stock in kg in the file.
- Deliveries (2D): a weighed product's quantity is entered in kg (3 decimals) and cost per kg; the preview uses grams.
- Profit tab: weighed products show kg sold.
- Leaving Pro: existing weighed products keep selling (weight box and labels), but switching products on and changing
  the label setting are refused.

## 7. Rollout

1. Apply `202611130060_weighed_items`. Safe before the app deploy: no product is sold by weight until switched on in the
   new app, and older tills send no `weightGrams`.
2. Deploy the 2F app after 060.

## 8. Testing

- Unit: `parseScaleLabel` (weight and price, each prefix and code length, bad check digit, ordinary EAN-13, leading
  zeros); price/grams rounding; kg input parsing; engine skips amount/multi-buy on weighed lines; sold-out in grams.
- SQL: weighed sale takes grams, refund restores; cost stamped by grams; kg delivery average in grams and void; switch
  refused with stock and on Starter; duplicate scale code; non-weighed sale unchanged; `profit_report.weightGrams`.
- Browser: label setting and test box; weight label, price label and typed weight at the till online and offline;
  receipt kg line; refund a weighed line; inventory kg; Profit kg sold; kg delivery.

## 9. Out of scope

- Till-connected scales (USB/serial); tare handling; partial refunds of a weighed line; units other than kg (litres,
  metres); printing scale labels from billo.

## 10. Open items

- None blocking.
