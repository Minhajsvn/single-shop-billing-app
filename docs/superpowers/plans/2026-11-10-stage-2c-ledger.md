# Build ledger — plan: docs/superpowers/plans/2026-11-10-stage-2c-categories-margin.md

Spec: docs/superpowers/specs/2026-11-10-stage-2c-categories-margin-design.md
Worktree: .claude/worktrees/stage-2c-categories-margin (branch stage-2c-categories-margin, base ff87fe7). Built natively in one session.
Env: local Supabase, worktree-only .env.local (local keys, copied from the 2B worktree); node_modules moved from the merged 2B worktree (same package-lock).

Setup: Ruling: ledger kept in docs/ like 2A/2B instead of the git-ignored sdd workspace — same record the plan's Task 11 asks for — cost if wrong: none.

Pre-flight:
- T2 → T3: T3 consumes `cost_reader_check` and cost columns; T2 produces both. Match.
- T4 → T7/T8/T10: `Category`, `liveCategories`, store actions consumed as produced. Match.
- T5 → T7/T9: `marginPct`, `priceExVatFils`, `isBelowCost`, `periodRange` consumed as produced. Match.
- T6 → T7/T9/T10: `fetchProductCosts`, `saveProductCost`, `fetchProfitReport`, `ProfitReport`. Match.
- T7 ↔ T9: T9 links `/inventory?filter=no-cost`; T7 must read that param. Noted in T7.
- T9 consumes `safeCsv` exported from `lib/reporting.ts`; not exported today — T9 exports it.
Task 1: complete (commits 7b4b6b0..a408e2e, tests: npm run test:sql → 5 PASS)
Task 2: Ruling: also revoke INSERT/UPDATE table-wide on products and INSERT on sale_items/credit_note_items, granting every column except cost back — otherwise an owner could write cost_fils straight into the table (skipping the Pro check and audit) and a member could insert a fake unit_cost_fils — cost if wrong: a future direct write to a new column fails until granted.
Task 2: Ruling: browser check for PostgREST permission errors moved to the full browser verification (Task 11) — local app not running yet — cost if wrong: a broken member query found later in the same build.
Task 2: complete (commits a408e2e..e627fd7, tests: npm run test:sql → 5 PASS)
Task 3: Ruling: uncostedLines counts sold lines only (not refund lines), and uncostedNetFils is net of refunds — the banner says "N sold lines have no cost" — cost if wrong: the count reads one higher or lower than the owner expects.
Task 3: Ruling: category and product rows report netFils over all lines but profit and margin over costed lines only, like the totals — so an uncosted line never looks like pure profit — cost if wrong: a row's net and profit look inconsistent until costs are entered.
Task 3: Ruling: top-50 test uses directly inserted lines on yesterday's date instead of 51 synced sales — same report path, much faster — cost if wrong: none.
Task 3: complete (commits e627fd7..2eb3f23, tests: npm run test:sql → 5 PASS)
Task 4: Ruling: the "normalizeState defaults categories" test targets a pure normalizeCategories() in lib/catalogue/categories.ts (used by normalizeState, parseHostedCache and restoreFromIndexed) — demo-store uses @/ imports node tests cannot load — cost if wrong: none.
Task 4: Ruling: added categoryName(), categorySyncProblems(), mergeSnapshot category handling, rejection texts and the outbox's syncable filter for categories (not named in the plan) — the outbox would otherwise never send category ops, and a refused one would point to Settings instead of Inventory — cost if wrong: none.
Task 4: complete (commits 2eb3f23..53f6f94, tests: npm test → 432/432; tsc clean apart from known PageProps; lint clean)
Task 5: Ruling: priceExVatFils nets every product at standard 5% (plan said zero/exempt = price) — checkout still charges standard VAT on all products (Stage 1D stores the category only), so the profit report's net is the 5% net; using 0% would make the form's margin disagree with the report — cost if wrong: the margin preview is off for zero-rated/exempt products until per-category VAT ships, which must update this helper.
Task 5: complete (commits 53f6f94..30dab81, tests: node --test tests/profit-math.test.mjs → 7/7)
