# Build ledger — plan: docs/superpowers/plans/2026-11-12-stage-2e-promotions.md

Spec: docs/superpowers/specs/2026-11-12-stage-2e-promotions-design.md
Worktree: .claude/worktrees/stage-2e-promotions (branch stage-2e-promotions, base 7fa9e5f). Built natively in one session.
Env: local Supabase, worktree-only .env.local (copied from 2D); node_modules moved from the merged 2D worktree (same lockfile).

Setup: Ruling: ledger kept in docs/ like 2A–2D — cost if wrong: none.

Pre-flight:
- T1 → T3: snapshot reads live promotions (RLS) and sale_items promotion columns; wrapper copies promotionId/promotionSavingFils by line id. Match.
- T2 → T3/T4/T5: Promotion type, isLive, applyPromotions, splitWholeFils. Match.
- T3 → T4: CheckoutLine/InvoiceLine promotion fields, DemoState.promotions. Match.
Task 2: Ruling: built before Task 1 while Docker started (the engine needs no database) — cost if wrong: none.
Task 2: Ruling: splitWholeFils(2000, 3) returns [2 × 667, 1 × 666] (spec §5.4: extra units cost base + 1), not the plan's [1 × 668, 2 × 666] — cost if wrong: none.
Task 2: Ruling: a cart line can become up to four output lines (a multi-buy group and its remainder, each split by the basket share), not two as the Global Constraints said — every one keeps gross = unit × qty — cost if wrong: a longer receipt for such lines.
Task 2: Ruling: custom items (no product) take no item offer but share a basket offer — cost if wrong: none.
Task 2: complete (commit 72e4229, tests: node --test tests/promotions-engine.test.mjs → 14/14)
Task 1: complete (commit bcb762f, tests: npm run test:sql → 8 PASS)
Task 3: complete (commit 76bd21a, tests: npm test → 489/489; tsc + eslint clean)
Task 4: Ruling: the POS keeps its existing cart state (list price, manual price via listUnitGrossFils) and derives the priced lines with a small adapter (lib/promotions/cart.ts: toCartInputs, checkoutLines, itemSummary) instead of switching the cart to CartInput — fewer changes in a large component; held carts already store list and manual prices, so a brought-back cart is re-priced with no change — cost if wrong: none.
Task 4: Ruling: the sale is completed with the priced lines shown on screen (re-priced every 30 s), not re-priced at the click — the payment dialog's total must equal the lines' total — cost if wrong: a sale finished seconds after a window closed keeps the offer.
Task 4: Ruling: the manager-approval limit counts manual discounts only (promotions never need approval) — cost if wrong: none.
Task 4: Ruling: lib/promotions/cart.ts and refresh.ts were written together with their tests (not watched failing first); the daily-report figure was test-first (RED then GREEN) — cost if wrong: weaker evidence that those tests would catch a regression.
Task 4: complete (commit e8961dd, tests: npm test → 494/494; tsc + eslint clean)
Task 5: Ruling: "Active now" lists every promotion that has started and not ended, paused or outside its hours included (the switch shows On/Paused) — a list of promotions running this very minute would hide a Friday happy hour on Wednesday — cost if wrong: none.
Task 5: Ruling: describePromotion swaps the non-breaking space formatAED returns for a plain space, so previews match the spec's wording — cost if wrong: none.
Task 5: complete (commit c51bd8f, tests: npm test → see run; tsc + eslint clean)
Task 6: Ruling: browser pass fixes — the "New promotion" button no longer stretches when the tabs wrap; day checkboxes get labels — cost if wrong: none.
Task 6: Ruling: offline sale with a promotion and a refund of a promoted item were not driven in the browser — the engine runs on the device (unit-tested), and refunds copy the charged price as before — cost if wrong: an offline-only UI difference.

## Evidence

- `npm test` 499/499; `npm run test:sql` 8 PASS (incl. promotions_test); lint clean; typecheck clean apart from known `PageProps`; `npm run build` passes.
- Browser (worktree dev server :3104, bundle checked for 127.0.0.1:54321 before sign-in; local Pro shop): owner created "Buy 2 get 1" on Medjool Dates (preview "Buy 2 get 1 free on Medjool Dates 1kg · from 11 Nov"); the till showed "Buy 2 get 1 · −AED 32.00" and "Promotions −AED 32.00", total 64.00 for 3 × 32.00; card sale receipt: 1 × 21.34 + 2 × 21.33 with "was AED 32.00 · saved … · Buy 2 get 1" and "You saved AED 32.00"; DB shows both lines with promotion_id, savings 1066 + 2134, cost 2583 stamped; Results tab: 1 use, 3 units, net 60.95, saving 32.00, profit −16.54. Starter (temporarily): till charged list price (96.00) and Promotions showed the Pro card.
