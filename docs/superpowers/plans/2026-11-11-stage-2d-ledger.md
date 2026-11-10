# Build ledger — plan: docs/superpowers/plans/2026-11-11-stage-2d-purchasing.md

Spec: docs/superpowers/specs/2026-11-11-stage-2d-purchasing-design.md
Worktree: .claude/worktrees/stage-2d-purchasing (branch stage-2d-purchasing, base 4b7c353). Built natively in one session.
Env: local Supabase, worktree-only .env.local (copied from the 2C worktree); node_modules moved from the merged 2C worktree (same lockfile).

Setup: Ruling: ledger kept in docs/ like 2A–2C instead of the git-ignored sdd workspace — cost if wrong: none.
Setup: Ruling: the spec's "Plan copy: Pro feature list says 'Suppliers and deliveries'" is dropped — the app has no feature-label list to update — cost if wrong: none.

Pre-flight:
- T1 → T2: T2 uses purchasing_check and suppliers from T1. Match.
- T2 → T4: routes call the five 058 functions with the jsonb shapes in T2's Produces; stock_too_low carries detail "name:stock". Match.
- T3 → T4/T6/T7: Supplier/Receipt types, mergeLines, draftTotals, costPreview, validateDraft, defaultInvoiceDate, purchasesCsv. Match.
- T4 → T6/T7/T8: client functions as named. Match.
- T5 → T6: /purchases reachable for manager. Match.
Task 1: complete (commits 06e177c..e29a8bb, tests: npm run test:sql → 7 PASS)
Task 2: Ruling: products.stock_quantity has check (>= 0), so the "stock −3" case cannot exist on the server; the SQL test uses stock 0 with an old cost (takes the new price) and the formula keeps greatest(stock, 0) defensively; the client preview still handles negative local stock — cost if wrong: none.
Task 2: Ruling: product_archived and duplicate_supplier_invoice carry a detail (product name; earlier invoice date) like stock_too_low, so the screen can say "Restore {name} first." and "already recorded on {date}" — cost if wrong: none.
Task 2: complete (commits e29a8bb..083096f, tests: npm run test:sql → 7 PASS)
Task 3: complete (commits 083096f..e9825a7, tests: node --test tests/purchasing-draft.test.mjs → 6/6)
Task 4: Ruling: client functions return { ok, <named field> } (e.g. { ok, suppliers }) rather than the bare values in the plan — screens need the refusal text — cost if wrong: none.
Task 4: complete (commits e9825a7..08acd9b, tests: node --test tests/purchasing-client.test.mjs → 6/6; tsc + eslint clean)
Task 5: complete (commits 08acd9b..4a9a67e, tests: npm test → see run; cashier-access 11/11)
Task 6/7: Ruling: shipped as one commit (screens share the gate, suppliers hook and download helper); a PurchasingGate component handles sample shop / Starter / offline for every purchases page — cost if wrong: none.
Task 6/7: Ruling: unit cost on a line starts from the product's current cost when costs load (useProductCosts, which needs categories_margin — also Pro); an empty or invalid cost blocks Save with "Enter a unit cost for {name}." — cost if wrong: a Pro shop without categories_margin would start blank (none exist today).
Task 6: complete (commit 5b62ec4, tests: tsc (known PageProps only) + eslint clean; browser check in Task 9)
Task 7: complete (same commit)
Task 8: complete (commits 5b62ec4..8cd9e5f, tests: npm test 471/471; tsc + eslint clean)
Task 9: Ruling: browser pass used owner and manager behind the PIN on the owner's till; a manager signed in on their own device was not driven (no local password for that account) — the page rules are unit-tested and the server checks every call — cost if wrong: an own-device manager navigation bug.
Task 9: Ruling: offline was not driven in the browser — PurchasingGate uses navigator.onLine and the client's offline texts are unit-tested — cost if wrong: an unclear message when the server, not the network, is down.

## Evidence

- `npm test` 471/471; `npm run test:sql` 7 PASS (incl. purchasing_test); lint clean; typecheck clean apart from the known fresh-checkout `PageProps` errors; `npm run build` passes.
- Browser (worktree dev server on :3103, bundle checked to call only 127.0.0.1:54321 before sign-in; local Pro shop): owner added supplier "Al Noor Trading" with TRN; on Record delivery a SKU scanned twice became one line of quantity 2 with the cost prefilled (25.00); quantity 10 at 27.00 previewed "Cost 25.00 → 25.83", net 270.00, VAT 13.50, total 283.50; saved, server cost 25.83 matched; the same invoice ("inv-77") was refused with "This supplier invoice is already recorded on 2026-11-10."; Inventory showed stock 24, cost 25.83, margin 15.3% and "Last delivered: 10 Nov · Al Noor Trading · AED 27.00 excl. VAT"; voiding with a reason marked the delivery voided, DB shows stock back to 14 with receipt +10 and correction_out −10, cost left at 25.83. Manager (PIN): Purchases and Reports in the nav, list loads. Cashier (PIN): no Purchases link, /purchases redirects to Overview. Starter (temporarily): the Pro card.
