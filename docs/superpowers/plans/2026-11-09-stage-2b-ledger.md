# Build ledger — plan: docs/superpowers/plans/2026-11-09-stage-2b-split-payment.md

Spec: docs/superpowers/specs/2026-11-09-stage-2b-split-payment-design.md
Worktree: .claude/worktrees/stage-2b-split-payment (branch stage-2b-split-payment, base 4962b00). Built natively in one session.
Env: local Supabase, worktree-only .env.local (local keys); local test owner from 2A (password reset into T2B_* lines).

## Decisions taken during the build (differ from the plan)

1. **`completeSale(lines, pay, …)` takes a method or a payment list** (`Payment[] | PayMethod`) instead of always a list,
   so Cash and Card keep their one-line calls; the store builds the single row. Both paths check the rows add up.
2. **Refund pay-back is a trailing argument**: `createCreditNote(saleId, quantities, found?, approvedByMemberId?, payBack?)`
   keeps the existing argument order; default is the sale's method (cash for a split sale).
3. **CSV gains per-document columns** "Cash AED", "Card AED", "Transfer AED" after the unchanged original columns
   (the plan named `transfer_sales` / `transfer_returns`; per-document amounts serve the same purpose and keep one row
   per document).
4. **No sales-list method filter was added**: the sales list has no method filter today (only date chips and search),
   so there was nothing to extend. Split sales still show "Split" with their parts on hover.
5. **Change on a split**: the receipt panel works out change on the cash part (`methodTotals(paymentsOf(sale)).cash`),
   so single-cash sales behave exactly as before.

## Deferred minors

- No SQL test for a credit note through `apply_credit_note_sync_with_payments` (needs a full sale with items in the
  fixture); covered end to end in the browser and offline run.
- The POS shortcut hint row still lists F2 and F3 only; F4 and F6 appear on the buttons themselves.
- Server-searched sales (older than this browser's history) show the summary badge without parts on hover.
- The local Supabase containers keep mount paths from the worktree that started them; after removing a worktree,
  `supabase stop` / `supabase start` from a live checkout is needed (hit during this build).

## Evidence

- `npm test` 407/407; `npm run test:sql` foundation, staff_pins and split_payment PASS; typecheck clean apart from the
  known fresh-checkout `PageProps` errors; lint clean; `npm run build` passes.
- Browser (dev server, Pro trial shop): split 50.00 cash (100 handed over) + 14.00 card → change 50.00, stored as
  cash 5000 + card 1400 with summary `split`; bank transfer with reference "TT-123" stored with the reference; refund
  of one item as transfer 10.00 + cash 22.00 stored as two rows. Starter (temporarily): Split shows "Pro plan" and is
  refused, Bank transfer opens, PIN lock is off.
- Offline production-build run (local API gateway stopped): split sale cash 12.00 + transfer 20.00 and a split refund
  cash 5.00 + card 27.00 made offline; after reconnecting and Sync now both synced with their rows; every sale in the
  local database is covered by its payment rows.
