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
