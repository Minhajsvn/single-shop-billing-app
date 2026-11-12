# SDD ledger — plan: docs/superpowers/plans/2026-11-13-stage-2f-weighed-items.md

Spec: docs/superpowers/specs/2026-11-13-stage-2f-weighed-items-design.md. Executor: native (executing-plans). Base 9bce30d.

## Pre-flight

- T2 → T3/T5/T6/T7/T8: `ScaleLabelSettings`, `parseScaleLabel`, kg helpers, `findWeighedByScaleCode` — consistent names across tasks.
- T3 → T4/T5: `CheckoutLine.weightGrams` / `pricePerKgFils` → `CartInput.weightGrams`, `PricedLine` passthrough — consistent.
- T1 → T3: server refusal codes `weight_mismatch`, `scale_code_taken`, `weight_switch_needs_zero_stock` mapped in `lib/sync/rejections.ts` — consistent; T1 adds `invalid_scale_code` (see ruling).
- T1 → T8: `shop_set_scale_label` errors `invalid_scale_label`, `feature_not_in_plan`; manager refusal is `not_owner` (see ruling).

## Tasks

Task 1: Ruling: the "latest bodies" of `apply_sale_sync` and `apply_credit_note_sync` are the migration texts as patched in place by 202610210029 (member guard, refund-line check) and 202610220032 (sale line `for update`) with search_path `public, extensions, pg_temp` — copying the raw migration text would have undone those fixes — cost if wrong: a refund race or cashier sync refusal; covered by the existing suites passing.
Task 1: Ruling: `void_purchase_receipt` is not replaced — it takes back the stored quantity, which is grams for weighed lines — cost if wrong: none found; test 5c covers it.
Task 1: Ruling: a refund of a line whose product has since switched how it is sold is saved without restocking (no movement) instead of refused — the customer still gets their money and stock never moves by grams-as-units — cost if wrong: an owner adjusts stock by hand; test 6a.
Task 1: Ruling: a direct `update businesses set scale_label` is refused by a trigger (`not_authorized`); only `shop_set_scale_label` may change it — owners have table UPDATE, which would bypass the Pro check — cost if wrong: none for the app (it uses the function).
Task 1: Ruling: manager refusal from `shop_set_scale_label` is `not_owner` (the existing `staff_require_owner` helper), not `not_authorized`; a non-integer or 0 scale code is `invalid_scale_code` — cost if wrong: client error mapping (Task 3/8 map both).
Task 1: Ruling: delivery test figures differ from the plan's example (stock 4500 g at 30.00/kg after the test's sales, so the average is 21.50) — same formula — cost if wrong: none.
Task 1: complete (commits 9bce30d..99fdbeb, tests: npm run test:sql → 9/9 suites pass)
Task 2: Ruling: lookup tests live in tests/weighing-kg.test.mjs, not checkout-lookup.test.mjs; an item code of 0 is not a label (not_scale), since scale codes start at 1; added linePricePerKg (per-kg kept on the device, else derived) for receipts — cost if wrong: none.
Task 2: complete (commits 99fdbeb..cea677c, tests: npm test → 509/509 pass)
Task 3: Ruling: productRecord moved to lib/store/product-sync.ts as productRecordOf, with weighingProblem (local scale-code and switch checks), so both are unit-tested — the store imports them — cost if wrong: none.
Task 3: Ruling: a held weighed line that no longer fits the stock in grams is dropped (not capped), and lines of a product switched to or from weighing since the hold are dropped with a notice; completeSale refuses a cart whose lines disagree with the product's current weighing; a local refund restocks only when line and product agree (mirrors the server ruling) — cost if wrong: a cashier re-adds an item.
Task 3: Ruling: feature_not_in_plan gets a generic rejection text "This needs the Pro plan." — cost if wrong: wording.
Task 3: complete (commits cea677c..75092a3, tests: npm test → 515/515 pass; lint clean; tsc clean)
Task 4: complete (commits 75092a3..6480172, tests: npm test → 517/517 pass)
Task 5: Ruling: scale-label problems show in their own notice above the products (like the unknown-code notice), with two extra messages for no_value and too_heavy; a ordinary barcode or SKU match on a weighed product opens the weight box — cost if wrong: wording.
Task 5: Ruling: found during the task — lib/snapshot/merge.ts replayed pending sales and refunds by quantity; it now uses weightGrams (test added), and migration 060 patches find_sale_by_invoice in place to return weight_grams (SQL test 2c), so a weighed line refunded from another till shows its weight — cost if wrong: stock off by grams until the next refresh.
Task 5: Ruling: a weighed line keeps the manual Discount button (it is one line at one price) — cost if wrong: none.
Task 5: complete (commits 6480172..8375782, tests: npm test → 521/521 pass; test:sql 9/9; lint, tsc clean)
Task 6: Ruling: import stock/low-stock cells are read as amounts with up to 3 decimals and converted once the product is known (kg→grams when weighed by the row or the matched product; must be whole otherwise); a new weighed product with no threshold gets 1 kg; Pro is required to switch a row to weighed (Selling by weight is part of the Pro plan); a scale code used by another product or twice in the file is a row problem — cost if wrong: a row the owner fixes and re-imports.
Task 6: Ruling: there is no stock-movement list in the UI, so the plan's 'movements list shows kg' needs no change; product labels (label sheet) still print the per-kg price without '/kg' — deferred minor — cost if wrong: a printed shelf label lacks /kg.
Task 6: complete (commits 8375782..d08b9e9, tests: npm test → 527/527 pass; lint, tsc clean)
Task 7: Ruling: a weighed product added to a delivery starts at 1 kg; the profit client passes the server JSON through, so weightGrams needs no mapping (types only); the profit CSV gains a Kg sold column after Quantity; delivery detail decides kg from the product's current soldByWeight (switching needs zero stock, so it matches in practice) — cost if wrong: one label.
Task 7: deferred minor: a refused void (stock_too_low, detail name:stock) shows a weighed product's stock in grams.
Task 7: complete (commits d08b9e9..7382c13, tests: npm test → 529/529 pass; lint, tsc clean)
Task 8: Ruling: the route refuses any body that is not already a valid setting (normalizeScaleLabel round-trip) before calling the RPC; not_owner also gets a message; the tab is hosted-owner only like Staff and sits after Tax and invoices; saving is disabled offline — cost if wrong: wording.
Task 8: complete (commits 7382c13..835d902, tests: npm test → 531/531 pass; lint, tsc clean; build ok)

## Task 9 evidence

- Automated: npm test 531/531; npm run test:sql 9/9 suites (weighed_items_test.sql new); lint clean; tsc clean (no errors outside the known fresh-checkout PageProps); npm run build ok.
- Browser (port 3106, bundle checked: 127.0.0.1:54321 present, production ref absent, before any input; local DB only, owner PIN 1111):
  - Inventory: added "Loose Dates 2F" sold by weight, AED 40.00/kg, 5 kg, scale code 1234 → local DB sold_by_weight true, scale_code 1234, stock 5000 g, low-stock 1000 g; list shows "5.000 kg" and "AED 40.00/kg".
  - Till: weight label 2101234007501 → line "0.750 kg × AED 40.00/kg" AED 30.00, card shows 4.250 kg available; bad check digit → "This label did not scan cleanly; scan again"; unknown code → "No weighed product with scale code 09999"; SKU of a weighed product opens the weight box; 5 kg → "Only 4.250 kg in stock."; 1.2 kg → AED 48.00 as its own line; card sale SL-1-261112-0001 AED 78.00; receipt lines read "0.750 kg × AED 40.00/kg"; server stock 3050 g, lines weight_grams 750/1200.
  - Invoice page: Qty "0.750 kg", unit "AED 40.00/kg"; return form "0.750 kg · AED 30.00 · returned whole"; credit note CN-1-261112-0001 → server stock 3800 g, credit line weight_grams 750.
  - Settings → Scale labels: test box "Item 01234 → Loose Dates 2F · 0.750 kg · AED 30.00"; switched to price labels and saved (DB value "price"); till price label 2101234030004 → 0.750 kg; switched back to weight and saved.
  - Delivery: 25.5 kg at AED 20.00/kg → line AED 510.00, saved "25.500 kg · AED 20.00/kg"; DB stock 29300 g, cost 2000, line_net 51000, by_weight true.
  - Profit tab (today): Loose Dates 2F "1.700 kg", cost AED 10.00 for the costed 500 g sale.
  - No console errors; no server errors. The temporary 2f-local launch entry was removed afterwards.
- Not verified in the browser: offline selling (the pane has no offline switch). Label parsing and the weight box run on the till with no server call, and the outbox replay is unit-tested (snapshot-merge Stage 2F test).
- Task 9: Ruling: the stale local register from 11 Nov was closed (counted AED 100.00, variance 0) and a new one opened to test selling — local data only — cost if wrong: none.
- Task 9: Ruling: the product form's weight switch got aria-label "Sold by weight" (its accessible name read "on" in the browser check) — cost if wrong: none.
Task 9: complete (commits 835d902..acb8cbd, tests: npm test → 531/531 pass; test:sql 9/9)
