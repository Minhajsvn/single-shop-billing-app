# SDD ledger — plan: docs/superpowers/plans/2026-10-15-stage-1c-checkout.md

Spec: docs/superpowers/specs/2026-10-11-saas-plans-and-improvements-design.md
Prior: 1A ledger docs/superpowers/plans/2026-10-11-stage-1a-ledger.md; 1B ledger docs/superpowers/plans/2026-10-13-stage-1b-ledger.md (1B merged 23ccb72)
Executor: INLINE (executing-plans), owner's choice. Branch stage-1c-checkout from 6ca40aa (worktree .claude/worktrees/stage-1c-checkout). Baseline npm test 72/72.
Owner decisions: per-item discounts; receipt panel (Enter = new sale), no auto-print. Owner approved the plan incl. the list-price DB column (Task 3) needed for UAE invoice discount disclosure.

## Pre-flight scan

| Pair | Produces vs consumes | Finding |
|---|---|---|
| T1 → T4/T5/T6 | discountedUnit, cartTotals, changeDue, quickCashAmounts, parseMoneyInput | consistent signatures |
| T2 → T5 | findByCode(products, code) | consistent |
| T2 → T6 | staleRegister(register, now); heldCartsKey/holdCart/resumeCart/MAX_HELD_CARTS/HeldCart | consistent |
| T3 → T4/T5 | InvoiceLine.listUnitGrossFils, CheckoutLine.listUnitGrossFils | T3 adds the field before T4 renders it and T5 sets it — order OK |
| T4 → T5/T6/T8 | printDocument, ReceiptDocument, PaymentDialog, ReceiptPanel | consistent |
| T3 SQL ↔ 1B migration 016 | apply_sale_sync current definition lives in 202610130016 | brief says copy from 016 (not 0007) — consistent |

## Progress
Task 1: complete (commits 6ca40aa..d4c0a61, tests: checkout-pricing 7/7 RED(module missing)→GREEN; npm test → 79/79)
Task 2: complete (commits d4c0a61..2f1b1ad, tests: lookup+register-status+held-carts 9/9 RED(modules missing)→GREEN; npm test → 88/88)
Task 3: complete (commits 2f1b1ad..70f67a0, tests: SQL section 17 RED(column missing)→GREEN, mapper+schema tests 2 RED→GREEN; npm test → 90/90; test:sql + rehearsal PASS; build+typecheck clean; apply_sale_sync copy verified: only the 2 planned hunks differ)
Task 4: Ruling: R1 — shop-identity logic (supplier snapshot → business → localStorage) extracted into useReceiptShop() in components/receipt-document.tsx so the invoice page and the POS receipt panel share it (brief only moved the markup) — avoids duplicating fiscal identity rules — if wrong: one hook to inline.
Task 4: complete (commits 70f67a0..91925ae, tests: npm test → 90/90; lint/typecheck/build clean; browser smoke (sample shop): 20.00 cash → "Cash received must cover the total" + Complete disabled; 100.00 → change AED 71.50; quick amounts 28.50/30/50/100; receipt panel SL-1-261015-0001 on /sale with New sale focused; Enter → search focused. Native print dialog not exercised.)
Task 4: minor (deferred): a stale Supabase session cookie for a deleted local user makes AuthGate treat the browser as hosted (sends to /setup) even after "Try the sample shop" — only when the auth user no longer exists; consider validating getUser() before taking the hosted path
Task 5: Ruling: R2 — inventory reads ?barcode= from window.location in an effect instead of useSearchParams() — avoids the Next 16 Suspense-boundary requirement for useSearchParams on a statically rendered page; query is cleared only after the dialog opens (survives React dev double-invoke) — if wrong: swap to useSearchParams + Suspense.
Task 5: Ruling: R3 — closing any POS dialog (discount, payment) returns focus to the search box — found in smoke: after a dialog closed, focus fell to <body> so F2/F3 and scanning stopped working (brief silent) — if wrong: none.
Task 5: complete (commits 91925ae..e592b38, tests: npm test → 90/90; lint/typecheck clean; browser smoke (sample shop): 2 scans → Arabic Coffee ×2, query cleared; unknown 9999999999 → notice + /inventory?barcode= link, cart unchanged; 15% → AED 24.23 each, line 48.46, Discount −8.54, Net 46.15 + VAT 2.31; F2 → pay 50 → change 1.54; receipt "2 × AED 24.23 / was AED 28.50 · saved AED 8.54", You saved 8.54; inventory dialog prefilled 9999999999. Server list-price persistence verified in Task 8 (hosted).)
Task 6: Ruling: R4 — the sample shop's seeded register now opens at load time (was a fixed 2026-08-30 timestamp) — with the stale guard, every fresh sample shop would otherwise be blocked from selling until the visitor closed a register; browsers with a saved sample state keep their old register (realistic) — if wrong: sample visitors close/reopen once.
Task 6: Ruling: R5 — HeldCarts loads its list after mount (setTimeout) rather than in the useState initializer — avoids a server/client markup mismatch for the "Held (n)" count — if wrong: none.
Task 6: complete (commits e592b38..3bdce4f, tests: npm test → 90/90 (held-carts + register-status units from Task 2); lint/typecheck clean; browser smoke (sample shop): stale register from 2026-08-30 → POS notice + Cash disabled, Register page notice; close + reopen → POS unlocked; Hold/Held(0) disabled on empty cart; hold 2× coffee → cart empty, Held (1) "AED 57.00 · 2 items"; Resume → Arabic Coffee ×2, Held (0).)
Task 7: Ruling: R6 — phone breakpoint for the POS cart bar is 760px (the app's existing mobile-nav breakpoint), not 768px — the bar must sit directly above the mobile nav; tablets 761–900px keep two columns — if wrong: 8px of width where tablets get the phone layout.
Task 7: Ruling: R7 — on phones the receipt panel (class cart-panel) is always shown as a bottom sheet, while the cart itself only shows when the sheet is opened — otherwise the post-sale panel would be hidden on phones — if wrong: none.
Task 7: Ruling: R8 — tablet product grid uses auto-fill (min 150px cards) instead of a fixed 2 columns — at 820px the sidebar leaves ~200px for products, where 2 fixed columns were ~95px wide — if wrong: cosmetic.
Task 7: complete (commits 3bdce4f..527717a, tests: npm test → 90/90; lint/typecheck clean; browser: 820px → columns "192.8px 300px", no overflow, cart beside products; 375px → no overflow, cart bar bottom 745 / mobile-nav top 744, 0 visible POS targets under 44px, sheet toggles (aria-expanded), Pay → "Cash payment" dialog; "1 item" grammar fixed.)
Task 8: smoke found 2 defects → fix 6a4664f: (a) resuming from the held-sales modal left focus on <body>, F2/F3 dead — resumeHeld now refocuses search (extends R3); (b) cart header + held list said "1 items" — formatItemCount (tests/checkout-pricing "formatItemCount…" RED→GREEN).
Task 8: Ruling: R9 — stale-register check backdated BOTH local register_sessions.opened_at and the cached openedAt (the brief says cache only) — the hosted snapshot refreshes from the server on reload, so editing the cache alone would not stick — if wrong: none (local DB only).
Task 8: complete (commits 527717a..6a4664f) — 1C smoke passed on local Supabase: 2 scans → qty 2 (57.00); 15% → 24.23 each, total 48.46, Discount −8.54; cash 50 → change 1.54, URL /sale, receipt "was AED 28.50 · saved AED 8.54" + "You saved"; DB SMK-1-261017-0001 gross 4846, qty 2, unit 2423, list 2850; unknown 9999999999 → cart unchanged, notice + /inventory?barcode= → dialog prefilled; hold/resume 3 → 3; stock→1 then resume → capped to 1 with "reduced to 1 (stock changed)"; card → receipt "Paid by Card", no change line (SMK-1-261017-0002); stale (opened 2026-10-16) → blocked + notice on /sale and /register, close + reopen → selling works; 375px: bar "1 item · AED 2.00", Pay → Cash dialog, scrollWidth = viewport. Suites: npm test 91/91, test:sql PASS, test:rehearsal PASS, lint 0, typecheck 0, build OK.
Final review: fresh reviewer (opus subagent) on 6ca40aa..6a4664f — 0 Critical, 4 Important, 10 Minor; verdict "with fixes".
Final: fixed stale register bypass at Dubai midnight / idle tab — tests/register-status "saleBlockReason refuses…" RED→GREEN; completeSale + pay() re-check at action time; suite 92/92 (525a7c8)
Final: fixed 80mm receipt clipped by sticky overflow-hidden cart panel — browser ancestor check RED ("panel cart-panel receipt-panel pos=sticky ov=hidden") → GREEN (no clipping ancestor, desktop and 375px); native print dialog still not exercised (525a7c8)
Final: fixed "Add product" from unknown scan discarding the cart — now holds the sale first (link reads "Hold sale & add product"); browser: Held 1→2 after following the link, barcode prefilled (525a7c8). Verified GREEN only; RED is by code reading (cart is plain useState).
Final: fixed focus lost after Hold/Clear/Remove — browser: activeElement = "Search products" after each (525a7c8). Verified GREEN only; same mechanism as the resume RED observed in Task 8.
Final: minor (deferred): phone cart sheet inherits top:16px from the 900px rule, so it hangs from the top rather than sitting on the cart bar (add top:auto in the 760px rule)
Final: minor (deferred): a tiny % discount can round to zero saving yet marks the line discounted ("saved AED 0.00")
Final: minor (deferred): server zod does not check listUnitGrossFils > unitGrossFils; a bad value surfaces as a raw DB constraint error
Final: minor (deferred): resume-while-cart-nonempty can lose the parked cart if the chosen held sale vanished (other tab)
Final: minor (deferred): a habitual scan inside the cash dialog sets an absurd tender and completes the sale (no sanity cap)
Final: minor (deferred): scan gaps — <4-char or punctuated codes silently ignored; name search + Enter says "No product with code"; inactive product barcode offers Add product (duplicate)
Final: minor (deferred): on the receipt panel the next customer's first scan is lost (Enter = New sale, per owner decision)
Final: minor (deferred): discount input uses Number() ("0x10" = 16%), no message for non-numeric
Final: minor (deferred): sample-mode stale check during render could mismatch hydration on a long-running server across Dubai midnight
Final: minor (deferred): A4 invoice lacks a total-discount row; "Print A4" only links; held-carts error never cleared
