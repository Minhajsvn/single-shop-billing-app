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
