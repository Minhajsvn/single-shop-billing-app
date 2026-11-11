# Build ledger — plan: docs/superpowers/plans/2026-11-12-stage-2e-promotions.md

Spec: docs/superpowers/specs/2026-11-12-stage-2e-promotions-design.md
Worktree: .claude/worktrees/stage-2e-promotions (branch stage-2e-promotions, base 7fa9e5f). Built natively in one session.
Env: local Supabase, worktree-only .env.local (copied from 2D); node_modules moved from the merged 2D worktree (same lockfile).

Setup: Ruling: ledger kept in docs/ like 2A–2D — cost if wrong: none.

Pre-flight:
- T1 → T3: snapshot reads live promotions (RLS) and sale_items promotion columns; wrapper copies promotionId/promotionSavingFils by line id. Match.
- T2 → T3/T4/T5: Promotion type, isLive, applyPromotions, splitWholeFils. Match.
- T3 → T4: CheckoutLine/InvoiceLine promotion fields, DemoState.promotions. Match.
