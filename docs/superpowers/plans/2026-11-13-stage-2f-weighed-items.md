# Stage 2F: Weighed Items and Scale Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pro shops sell loose goods by weight: scale labels and typed weights at the till, stock in grams, costs,
deliveries, promotions and profit in kg.

**Architecture:** One migration (060) adds weight columns and replaces the sync, delivery and profit functions so a
weighed line is quantity 1 with `weight_grams`, and stock moves by grams. A pure `lib/weighing/` module parses labels and
does kg/price maths; the till, store, inventory, deliveries, profit and settings call it. Older tills send no
`weightGrams` and keep working for ordinary products.

**Tech Stack:** Next.js 16 app router, React client components, Supabase Postgres (security-definer functions, RLS,
column grants), zod sync schema, `node --test` unit tests, SQL tests (`npm run test:sql`).

**Spec:** `docs/superpowers/specs/2026-11-13-stage-2f-weighed-items-design.md`

## Global Constraints

- Migration file: `supabase/migrations/202611130060_weighed_items.sql`; SQL tests: `supabase/tests/weighed_items_test.sql` (one rolled-back transaction, `assert`).
- Every replaced function is copied from its latest body (`apply_sale_sync` 202610190024, `apply_credit_note_sync` 202610130016, `apply_product_sync` 202611100053, `apply_sale_sync_with_payments` 202611120059, `record_purchase_receipt` / `void_purchase_receipt` 202611110058, `profit_report` 202611100055) and keeps every existing check; security definer with `set search_path = public, extensions, pg_temp`.
- Refusals are P0001 with these exact messages: `weight_switch_needs_zero_stock`, `scale_code_taken`, `weight_mismatch`, `feature_not_in_plan`.
- Integers only: grams, fils. `weight_grams` 1–100000; `scale_code` 1–999999; delivery grams 1–100000000.
- Weight label price = round(grams × price per kg ÷ 1000), at least 1 fils. Price label grams = round(price ÷ price per kg × 1000), at least 1.
- Scale label default `{"prefixes":["21","22"],"codeLength":5,"value":"weight"}`; prefixes 1–10 two-digit strings "20"–"29"; codeLength 4–6; value `weight` | `price`.
- Feature key `weighed_items` (Pro). Leaving Pro: existing weighed products keep selling; switching on and changing the label setting are refused.
- Display: kg with 3 decimals ("0.750 kg"); price "AED 40.00 /kg"; receipt line "0.750 kg × AED 40.00/kg".
- Copy (exact): "No product with code …" (existing), "No weighed product with scale code 01234", "This label did not scan cleanly; scan again".
- Local Supabase only (worktree `.env.local`). Never run the dev server or tests from the main checkout. Production migration only on the user's "apply them".

## Review Focus

1. An old till (or an outbox queued before 2F) sends a line without `weightGrams` for a product now sold by weight → server refuses with `weight_mismatch`, never takes 1 gram (Task 1, sale and refund tests).
2. A label whose value digits read zero, or above 100 kg (codeLength 4 leaves 6 value digits) → the till refuses with a clear message, adds nothing (Task 2 tests).
3. An ordinary product EAN that starts with a configured prefix (e.g. "2212345678907" printed on a normal item) → the ordinary product wins (Task 2 lookup test).
4. A held cart or saved state from before 2F (lines with no `weightGrams`, products with no `soldByWeight`) → loads as non-weighed; a held weighed line resumes with its own key and grams (Task 3 test).
5. Places that sum quantities as units (cart item count, till grid "N available", invoice Qty column) → weighed lines count as 1 item and show kg, never grams as units (Task 2 `formatStock` test; Task 5 cart count).

---

### Task 1: Migration 060 and SQL tests

**Files:**
- Create: `supabase/migrations/202611130060_weighed_items.sql`
- Create: `supabase/tests/weighed_items_test.sql`

**Interfaces:**
- Produces (columns): `products.sold_by_weight boolean not null default false`, `products.scale_code integer` (unique index `(business_id, scale_code) where scale_code is not null`), `sale_items.weight_grams`, `credit_note_items.weight_grams` (check 1–100000, null otherwise; granted to `authenticated` like the 2C column grants), `businesses.scale_label jsonb not null default '{"prefixes":["21","22"],"codeLength":5,"value":"weight"}'` with a check function `scale_label_valid(jsonb) returns boolean`, `purchase_receipt_lines.by_weight boolean not null default false`.
- Produces (functions): `shop_set_scale_label(p_business_id uuid, p_settings jsonb) returns jsonb` (owner only, `weighed_items` required, returns the stored settings); `apply_product_sync` accepts payload `soldByWeight` (boolean, absent = keep) and `scaleCode` (integer or null, absent = keep); sale line payload `weightGrams`; credit note copies `weight_grams` from the sale line; `profit_report` `byProduct[].weightGrams` (bigint or null).

- [ ] **Step 1: Write the failing SQL tests** in `supabase/tests/weighed_items_test.sql`, seeding a Pro shop and a Starter shop the way `promotions_test.sql` does. Assertions:
  - product sync with `soldByWeight: true` on a product with stock 0 → `sold_by_weight` true; same with stock 5 → `weight_switch_needs_zero_stock`; on the Starter shop → `feature_not_in_plan`.
  - two products with `scaleCode: 1234` → second refused `scale_code_taken`; another shop may reuse 1234.
  - weighed product, stock 5000 g, price 4000/kg, cost 3000/kg: sale line `{quantity:1, unitGrossFils:3000, weightGrams:750}` → stock 4250, movement `quantity_delta = -750`, `sale_items.weight_grams = 750`, `unit_cost_fils = 2250`.
  - same product, line without `weightGrams` → `weight_mismatch`; line with `weightGrams` and quantity 2 → `weight_mismatch`; `weightGrams` on a non-weighed product → `weight_mismatch`; `weightGrams: 100001` → `weight_mismatch`.
  - refund of the weighed line (quantity 1) → stock back to 5000, `credit_note_items.weight_grams = 750`, movement `+750`.
  - ordinary product sale of 2 → stock −2, `weight_grams` null (unchanged behaviour).
  - delivery of the weighed product, `quantity: 25500` (grams), `unitCostFils: 2000` (per kg) onto 4250 g at 3000/kg → `line_net_fils = 51000`, `by_weight` true, stock 29750, `cost_fils = round((4250×3000 + 25500×2000)/29750) = 2143`; void → stock 4250.
  - `profit_report` row for the weighed product has `weightGrams = 750` before the refund and `0` after; an ordinary product's `weightGrams` is null.
  - `shop_set_scale_label` with `{"prefixes":["19"],...}` → `invalid_scale_label`; valid settings stored; on Starter → `feature_not_in_plan`; as a manager → `not_authorized`.

- [ ] **Step 2: Run to verify failure**
  Run (from the worktree): `npm run test:sql`
  Expected: `weighed_items_test.sql` fails (column `sold_by_weight` does not exist).

- [ ] **Step 3: Write migration 060.** Order: columns and checks → grants → `scale_label_valid` and `shop_set_scale_label` → `apply_product_sync` → `apply_sale_sync` → `apply_credit_note_sync` → `apply_sale_sync_with_payments` → purchase receipt check swap, `record_purchase_receipt`, `void_purchase_receipt` → `profit_report`. Decisions the bodies need:
  - Sale line: `v_grams := nullif(line->>'weightGrams','')::integer`. If the product is `sold_by_weight` then `v_grams` must be 1–100000 and quantity 1; if not, `v_grams` must be null; else `weight_mismatch`. Stock check and decrement use `coalesce(v_grams, line_quantity)`.
  - Credit note line: grams come from the sale line (`sale_items.weight_grams`), never the payload; a weighed sale line refunds only at quantity 1; stock restore uses `coalesce(grams, quantity)`.
  - Wrapper cost stamp: `case when si.weight_grams is not null then round(p.cost_fils * si.weight_grams / 1000.0) else p.cost_fils end`; promotion copy and the 056 split-cash movement unchanged.
  - Delivery: when the product is `sold_by_weight`, quantity is grams (1–100000000), `line_net_fils = round(quantity × unit_cost_fils / 1000.0)`, weighted average `round((stock × cost + grams × unit_cost) / (stock + grams))`, `by_weight = true`. Replace the 2D line check with one that applies the old quantity range only `where not by_weight`.
  - `shop_set_scale_label` raises `invalid_scale_label` when `scale_label_valid` is false.

- [ ] **Step 4: Apply locally and run tests**
  Run: `node <scratchpad>/apply-mig.mjs supabase/migrations/202611130060_weighed_items.sql` then `npm run test:sql`
  Expected: all 9 suites pass (8 existing + weighed_items).

- [ ] **Step 5: Commit** `feat(2f): weighed items migration and SQL tests`

### Task 2: Weighing library (labels, kg maths, lookup)

**Files:**
- Create: `lib/weighing/types.ts`, `lib/weighing/label.ts`, `lib/weighing/kg.ts`
- Modify: `lib/checkout/lookup.ts` (add `findWeighedByScaleCode`)
- Test: `tests/weighing-label.test.mjs`, `tests/weighing-kg.test.mjs`, `tests/checkout-lookup.test.mjs`

**Interfaces:**
- Produces:
  - `type ScaleLabelSettings = { prefixes: string[]; codeLength: 4 | 5 | 6; value: "weight" | "price" }`; `DEFAULT_SCALE_LABEL`; `normalizeScaleLabel(raw: unknown): ScaleLabelSettings` (invalid → default) — `types.ts`.
  - `parseScaleLabel(code: string, settings: ScaleLabelSettings): { kind: "weight"; scaleCode: number; grams: number } | { kind: "price"; scaleCode: number; priceFils: number } | { error: "not_scale" | "bad_check_digit" | "no_value" | "too_heavy" }` — `label.ts`. Layout: 2 prefix digits, `codeLength` item digits, `13 − 2 − codeLength − 1` value digits, check digit.
  - `parseKgInput(text: string): number | null` (grams; "0.75" → 750; 0.001–100 kg, up to 3 decimals, dot only), `formatKg(grams: number): string` ("0.750 kg"), `priceForGrams(pricePerKgFils, grams): number`, `gramsForPrice(priceFils, pricePerKgFils): number`, `perKgText(pricePerKgFils): string` ("AED 40.00/kg"), `weighedLineText(grams, pricePerKgFils): string` ("0.750 kg × AED 40.00/kg"), `formatStock(product: Pick<Product,"stock"|"soldByWeight">): string` ("4.250 kg" or "12") — `kg.ts`.
  - `findWeighedByScaleCode(products: Product[], scaleCode: number): Product | null` (active and `soldByWeight` only) — `lookup.ts`.

- [ ] **Step 1: Write failing tests.** Label (settings `{prefixes:["21","22"],codeLength:5,value:"weight"}` unless stated):
  - `parseScaleLabel("2101234007501", s)` → `{kind:"weight", scaleCode:1234, grams:750}` (check digit computed with `isValidEan13`; build fixtures with a helper that appends the check digit).
  - price mode, value digits `03000` → `{kind:"price", scaleCode:1234, priceFils:3000}`.
  - codeLength 4 (6 value digits) and 6 (4 value digits) each parse; leading zeros keep (`scaleCode` 1 from `00001`).
  - prefix "23" not configured → `not_scale`; 12-digit code → `not_scale`; wrong last digit → `bad_check_digit`; value 0 → `no_value`; codeLength 4 weight value `100001` → `too_heavy`.
  - Kg: `parseKgInput("0.75")` 750, `"1.2345"` null, `"0"` null, `"100"` 100000, `"100.001"` null, `"abc"` null; `priceForGrams(4000, 750)` 3000, `priceForGrams(4000, 1)` 4, `priceForGrams(1, 1)` 1; `gramsForPrice(3000, 4000)` 750, `gramsForPrice(1, 400000)` 1; `formatKg(4250)` "4.250 kg"; `weighedLineText(750, 4000)` "0.750 kg × AED 40.00/kg" (normalize the non-breaking space with `/ /g` in assertions); `formatStock({stock:4250, soldByWeight:true})` "4.250 kg", `formatStock({stock:12})` "12".
  - Lookup: `findWeighedByScaleCode` ignores inactive and non-weighed products; `findByCode` still returns an ordinary product whose barcode is "2212345678907" (Review Focus 3, checked at the till in Task 5 by calling `findByCode` before `parseScaleLabel`).

- [ ] **Step 2: Run** `npm test` — Expected: the new tests fail (modules missing).
- [ ] **Step 3: Implement** the three files and `findWeighedByScaleCode`. `too_heavy` when weight grams > 100000; `no_value` when the value is 0. `Product` gains `soldByWeight?: boolean; scaleCode?: number | null` in `lib/domain.ts` (needed for types here).
- [ ] **Step 4: Run** `npm test` — Expected: all pass.
- [ ] **Step 5: Commit** `feat(2f): scale label parsing and kg maths`

### Task 3: Domain, snapshot, sync schema and store in grams

**Files:**
- Modify: `lib/domain.ts`, `lib/snapshot/types.ts`, `lib/snapshot/map-rows.ts`, `app/api/v1/snapshot/route.ts`, `lib/sync/request-schema.ts`, `lib/sync/rejections.ts`, `lib/store/hosted.ts`, `lib/demo-store.ts`, `lib/checkout/held-carts.ts`
- Test: `tests/snapshot-map.test.mjs`, `tests/sync-request.test.mjs`, `tests/held-carts.test.mjs`, `tests/product-sync.test.mjs`

**Interfaces:**
- Consumes: `ScaleLabelSettings`, `normalizeScaleLabel` (Task 2).
- Produces:
  - `InvoiceLine.weightGrams?: number` and `InvoiceLine.pricePerKgFils?: number` (the latter kept on this device only, like `promotionName`; receipts fall back to `round(unitGross × 1000 / grams)` when absent).
  - `CheckoutLine` gains `weightGrams?: number; pricePerKgFils?: number`.
  - `ShopSnapshot.scaleLabel: ScaleLabelSettings`; shop context exposes `scaleLabel` (like `lockSettings`).
  - `ProductPatch` gains `soldByWeight`, `scaleCode`; `addProduct`/`updateProduct` refuse a duplicate scale code locally with "Scale code {n} is already used by {name}." and refuse a sold-by-weight switch while stock ≠ 0 with "Set stock to 0 before changing how this product is sold."
  - `completeSale` and `createCreditNote` move stock by `weightGrams ?? quantity`.

- [ ] **Step 1: Write failing tests:**
  - snapshot: a product row with `sold_by_weight: true, scale_code: 1234` maps to `soldByWeight: true, scaleCode: 1234`; a row without them maps to `soldByWeight: false, scaleCode: null`; a sale item with `weight_grams: 750` maps to `weightGrams: 750`; business `scale_label` absent → `DEFAULT_SCALE_LABEL`.
  - sync schema: a sale line with `weightGrams: 750` parses; `weightGrams: 0` and `100001` fail; a product record with `soldByWeight: true, scaleCode: 1234` parses; `scaleCode: 0` fails; `scaleCode: null` parses.
  - held carts: a held line `{productId, quantity:1, unitGrossFils:3000, weightGrams:750, pricePerKgFils:4000}` round-trips; a pre-2F held line without them stays unchanged (Review Focus 4).
  - product sync payload builder sends `soldByWeight` and `scaleCode`.
  - rejections: `weight_mismatch` → "This till is out of date for a product sold by weight. Reload the till and sell it again."; `scale_code_taken` → "That scale code is already used by another product."; `weight_switch_needs_zero_stock` → "Set stock to 0 before changing how this product is sold."
- [ ] **Step 2: Run** `npm test` — Expected: new assertions fail.
- [ ] **Step 3: Implement.** Snapshot route selects `scale_label` from businesses, `sold_by_weight, scale_code` from products, `weight_grams` in both item selects. `normalizeState` leaves old products as is (`soldByWeight` absent = false). In `completeSale` the `requested` map and movement delta use `item.weightGrams ?? item.quantity`; the stock error for a weighed product reads "{name} has only {formatKg(stock)} available.". In `createCreditNote` a weighed line restores `item.weightGrams`.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` — Expected: pass (ignore the known fresh-checkout `PageProps` errors).
- [ ] **Step 5: Commit** `feat(2f): weights through snapshot, sync and store`

### Task 4: Promotions engine skips AED-off and multi-buys on weighed lines

**Files:**
- Modify: `lib/promotions/engine.ts`, `lib/promotions/cart.ts`
- Test: `tests/promotions-engine.test.mjs`, `tests/promotions-cart.test.mjs`

**Interfaces:**
- Produces: `CartInput.weightGrams?: number`; `PricedLine.weightGrams?: number`, `PricedLine.pricePerKgFils?: number`; `toCartInputs` passes `weightGrams`; `checkoutLines` passes `weightGrams` and `pricePerKgFils` through.

- [ ] **Step 1: Write failing tests:** a weighed line (qty 1, 3000 fils, `weightGrams: 750`) under a `percent_off` 10% product promotion → 2700; under `amount_off` → 3000 (untouched); two weighed lines of the same product under `multi_buy_free` buy 1 get 1 → both full price; basket 10% over 2000 → weighed line discounted; `checkoutLines` keeps `weightGrams: 750`.
- [ ] **Step 2: Run** `npm test` — Expected: the amount_off and multi-buy cases fail.
- [ ] **Step 3: Implement:** in the engine's eligibility filter, `amount_off`, `multi_buy_free` and `multi_buy_price` exclude inputs with `weightGrams`.
- [ ] **Step 4: Run** `npm test` — Expected: pass.
- [ ] **Step 5: Commit** `feat(2f): promotions on weighed lines`

### Task 5: Till: weight box, label scans, kg cart lines and receipts

**Files:**
- Create: `components/pos/weight-dialog.tsx`, `lib/weighing/cart.ts`
- Modify: `components/pos-workspace.tsx`, `components/receipt-document.tsx`, `components/invoice-detail-workspace.tsx`, `lib/checkout/pricing.ts` (`formatItemCount`)
- Test: `tests/weighing-cart.test.mjs`, `tests/checkout-pricing.test.mjs`

**Interfaces:**
- Consumes: `parseScaleLabel`, `findWeighedByScaleCode`, `priceForGrams`, `gramsForPrice`, `parseKgInput`, `weighedLineText`, `formatStock` (Task 2); `scaleLabel` from shop context (Task 3).
- Produces: `cartUsage(lines: { productId?: string; quantity: number; weightGrams?: number }[], productId: string): number` (grams for weighed lines, units otherwise); `weighedLine(product: Product, grams: number): CheckoutLine & { key: string }` (random key, quantity 1, `unitGrossFils = priceForGrams`, `weightGrams`, `pricePerKgFils = product.priceFils`); `WeightDialog({ product, available, onAdd(grams), onCancel })`.

- [ ] **Step 1: Write failing tests:** `cartUsage` sums 750 + 500 grams for a weighed product and units for another; `weighedLine(product{priceFils:4000}, 750)` has quantity 1, unitGrossFils 3000, a fresh key each call; `formatItemCount` counts a weighed line as 1 item.
- [ ] **Step 2: Run** `npm test` — Expected: fail (module missing).
- [ ] **Step 3: Implement `lib/weighing/cart.ts`, then the till:**
  - `scan`: `findByCode` first; a weighed match opens the weight box. Else `parseScaleLabel(code, scaleLabel)`: `bad_check_digit` → "This label did not scan cleanly; scan again"; `no_value` → "This label has no weight or price; weigh it again"; `too_heavy` → "This label is over 100 kg; weigh it again"; a parsed label with no product → "No weighed product with scale code {code padded to codeLength}"; a match adds `weighedLine` directly (price label: grams = `gramsForPrice`, unit = label price). `not_scale` falls through to the existing unknown-code notice.
  - Tapping a weighed product card opens `WeightDialog` (kg input, live price, Enter adds); card badge shows `formatStock` minus `cartUsage`; sold out when available < 1 g.
  - Stock checks use `cartUsage`; a weighed line has no quantity stepper and its line shows `weighedLineText`.
  - `heldLines` and `resumeHeld` carry `weightGrams` / `pricePerKgFils`; weighed lines resume with a fresh key.
  - Receipt and invoice: a line with `weightGrams` shows "{name} · {weighedLineText}" instead of "qty × unit"; the invoice Qty cell shows `formatKg`.
- [ ] **Step 4: Run** `npm test`, `npm run lint` — Expected: pass, no warnings.
- [ ] **Step 5: Commit** `feat(2f): sell by weight at the till`

### Task 6: Inventory, product form, stock adjust and CSV in kg

**Files:**
- Modify: `components/catalogue/product-form.tsx`, `components/inventory-workspace.tsx`, `lib/catalogue/columns.ts`, `lib/catalogue/csv.ts`, `lib/catalogue/parse.ts`, `lib/catalogue/classify.ts`
- Test: `tests/catalogue-csv.test.mjs`, `tests/catalogue-parse.test.mjs`, `tests/catalogue-classify.test.mjs`

**Interfaces:**
- Consumes: `formatStock`, `parseKgInput`, `formatKg`, `perKgText` (Task 2); `ProductPatch` fields (Task 3); `useEntitlement().hasFeature("weighed_items")`.
- Produces: CSV columns "Sold by weight" (yes/no) and "Scale code" appended after the existing ones; weighed stock and low-stock written and read in kg.

- [ ] **Step 1: Write failing tests:** export of a weighed product (stock 4250) writes `Sold by weight = yes`, `Scale code = 1234`, `Stock = 4.250`; import of `yes, 1234, 2.5` creates `soldByWeight: true, scaleCode: 1234, stock: 2500`; import that flips an existing product with stock to weighed → row error "Set stock to 0 before changing how this product is sold."; a file without the new columns imports as today.
- [ ] **Step 2: Run** `npm test` — Expected: fail.
- [ ] **Step 3: Implement.** Product form: "Sold by weight" switch (disabled with that hint while stock ≠ 0; disabled with a Pro hint without `weighed_items` unless already on), "Scale code" field (digits, 1–999999), price and cost labelled "per kg", opening stock and low-stock in kg. Inventory: stock, low-stock and price via `formatStock` / `perKgText`; Adjust stock takes kg for weighed products and stores grams; movements list shows kg for weighed products.
- [ ] **Step 4: Run** `npm test`, `npm run lint` — Expected: pass.
- [ ] **Step 5: Commit** `feat(2f): weighed products in inventory and import`

### Task 7: Deliveries in kg and Profit kg sold

**Files:**
- Modify: `lib/purchasing/draft.ts`, `components/purchasing/*` (delivery line editor and receipt view), `lib/profit/types.ts`, `lib/profit/client.ts`, `lib/profit/csv.ts`, `components/reports/profit-tab.tsx`
- Test: `tests/purchasing-draft.test.mjs`, `tests/profit-client.test.mjs`, `tests/profit-csv.test.mjs`

**Interfaces:**
- Consumes: `parseKgInput`, `formatKg` (Task 2).
- Produces: draft lines for weighed products hold `quantity` in grams with `byWeight: true`; draft preview net `round(grams × unitCostFils / 1000)`; `ProfitProductRow.weightGrams: number | null`.

- [ ] **Step 1: Write failing tests:** a draft line for a weighed product with kg text "25.5" and cost 20.00 → quantity 25500, net 51000; a second scan of a weighed product does not add 1 (opens kg entry instead: the draft helper returns the line unchanged); profit client maps `weightGrams`; profit CSV adds a "Kg sold" column ("0.750", empty when null).
- [ ] **Step 2: Run** `npm test` — Expected: fail.
- [ ] **Step 3: Implement;** the delivery editor labels quantity "kg" and cost "per kg" for weighed products; the Profit tab shows "0.750 kg" under units for weighed rows.
- [ ] **Step 4: Run** `npm test` — Expected: pass.
- [ ] **Step 5: Commit** `feat(2f): kg deliveries and kg sold`

### Task 8: Settings → Scale labels

**Files:**
- Create: `app/api/v1/business/scale-label/route.ts`, `components/settings/scale-label-tab.tsx`, `lib/weighing/client.ts`
- Modify: `app/(dashboard)/settings/page.tsx`
- Test: `tests/weighing-client.test.mjs`

**Interfaces:**
- Consumes: `ScaleLabelSettings`, `parseScaleLabel`, `findWeighedByScaleCode`, `formatKg` (Task 2); `refreshSnapshot`.
- Produces: `saveScaleLabel(settings: ScaleLabelSettings): Promise<{ ok: true } | { ok: false; error: string }>` (POST, maps `invalid_scale_label` → "Check the prefixes (20–29) and item code length (4–6).", `feature_not_in_plan` → "Scale labels are part of the Pro plan."); `describeTest(code, settings, products): string`.

- [ ] **Step 1: Write failing tests:** `describeTest("2101234007501", s, [dates{scaleCode:1234, priceFils:4000}])` → "Item 01234 → Medjool Dates · 0.750 kg · AED 30.00" (nbsp normalized); unknown item → "Item 01234 → no weighed product has this scale code"; bad check digit → "This label did not scan cleanly; scan again"; not a label → "Not a scale label for these settings"; `saveScaleLabel` maps the two errors.
- [ ] **Step 2: Run** `npm test` — Expected: fail.
- [ ] **Step 3: Implement** the route (zod body, `shop_set_scale_label` RPC, same auth pattern as `app/api/v1/staff/settings/route.ts`) and the tab (owner, hosted; Pro card without `weighed_items`; prefixes as 20–29 checkboxes, code length select, weight/price radio, test box). Add `{ tab: "scale-labels", label: "Scale labels" }` for hosted owners.
- [ ] **Step 4: Run** `npm test`, `npm run lint`, `npm run build` — Expected: pass.
- [ ] **Step 5: Commit** `feat(2f): scale label settings with test box`

### Task 9: Release notes, browser verification, ledger

**Files:**
- Modify: `docs/RELEASE_CHECKLIST.md` (add "Stage 2F: weighed items and scale labels": apply 060 before the app; deploy after; smoke test list from spec §8 browser line; support note: tills need the 2F app before selling a weighed product, older tills get `weight_mismatch` for it)
- Create: `docs/superpowers/plans/2026-11-13-stage-2f-ledger.md`

- [ ] **Step 1:** Run `npm test`, `npm run test:sql`, `npm run lint`, `npm run build` from the worktree — Expected: all pass; record counts in the ledger.
- [ ] **Step 2:** Browser pass on a temporary worktree launch entry (port 3106; check the bundle has `127.0.0.1:54321` and not the production ref before signing in): set the label setting and test box; sell by weight label, price label and typed weight online and offline; receipt kg line; refund a weighed line; inventory kg; Profit kg sold; kg delivery. Remove the launch entry afterwards.
- [ ] **Step 3:** Write the ledger (evidence, rulings, deferred minors) and the release checklist section.
- [ ] **Step 4: Commit** `docs(2f): release notes and ledger`
