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
