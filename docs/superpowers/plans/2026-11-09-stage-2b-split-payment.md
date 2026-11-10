# Stage 2B: Split payment and bank transfer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sales and refunds carry one payment row per method (cash, card, bank transfer); any plan can take a whole-sale bank transfer; Pro can split.

**Architecture:** Three migrations: add the enum values (on their own, because new enum values cannot be used in the transaction that adds them), add `sale_payments` / `credit_note_payments` with row security and a backfill, and add wrapper RPCs `apply_sale_sync_with_payments` / `apply_credit_note_sync_with_payments` that validate the payment list, call the existing sync function and insert the rows in the same transaction, so the big sync functions are not copied. On the client, a pure `lib/payments/` module does the maths; the store, snapshot, register totals, reporting, receipts, lists and the payment and refund windows read payment rows.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` before route/UI code, per AGENTS.md), TypeScript, Supabase Postgres + RLS, `node --test`, `npm run test:sql`.

**Spec:** `docs/superpowers/specs/2026-11-09-stage-2b-split-payment-design.md`

## Global Constraints

- Payment-row methods: `cash`, `card`, `transfer`. `split` is only a document's summary method.
- At most one row per method per document; every `amount_fils` > 0; rows sum exactly to the document's `gross_fils`.
- `reference` only on `transfer`, at most 60 characters (the till trims before sending).
- Summary method: one row → that method; two or more → `split`.
- Sync refusal code for a bad list: P0001 `payments_mismatch`; nothing is saved. No plan check on the server.
- A record without `payments` (older till) gets one row from its `paymentMethod` for the full gross.
- Splitting is Pro (`split_payment`); bank transfer as a single method is every plan.
- Keys: Cash F2, Card F3, Bank transfer F4, Split F6 (F9 is Switch from 2A).
- Expected drawer cash = opening float + cash sale payments − cash refund payments + cash adjustments; card and transfer never count as drawer cash.
- The CSV keeps existing column names and adds transfer columns.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **Cash part with change on a split** — AED 100 handed over on a 50 cash part of a 77.20 sale shows change 50.00, and the cash payment row stores 50.00 (the part), not 100. Test in Task 4 (`splitSummary`) and Task 7.
- **Rest-on button when lines are already over the total** — pressing "Rest on card" when cash already exceeds the total must not create a negative or zero card line. Test in Task 4 (`restOn`).
- **Refund mix on a Starter shop** — only one method can be chosen; a two-method refund is impossible on Starter. Test in Task 8 (UI check) and Task 4 (`canSplit`).
- **Old cached sales without `payments`** — a till cache from before 2B must still total correctly in the register and reports (fallback to one row from `paymentMethod`). Test in Task 4 (`paymentsOf`).
- **Retry after a network drop mid-sync** — the same operation sent twice saves the payment rows once. Test in Task 3 (SQL).

---

### Task 1: Enum values (migration)

**Files:**
- Create: `supabase/migrations/202611090049_payment_methods.sql`
- Create: `supabase/tests/split_payment_test.sql` (first section)

**Interfaces:**
- Produces: `public.payment_method` gains `transfer` and `split`.

- [ ] **Step 1:** Write the test section: `assert 'transfer' = any(enum_range(null::public.payment_method)::text[])` and the same for `split`.
- [ ] **Step 2:** `npm run test:sql -- supabase/tests/split_payment_test.sql` → FAIL.
- [ ] **Step 3:** Migration with only `alter type public.payment_method add value if not exists 'transfer';` and `'split'`.
- [ ] **Step 4:** `supabase migration up --local`, rerun → PASS.
- [ ] **Step 5:** Commit — `feat(payments): transfer and split payment methods (SQL)`.

### Task 2: Payment tables, row security, backfill (migration)

**Files:**
- Create: `supabase/migrations/202611090050_payment_rows.sql`
- Test: `supabase/tests/split_payment_test.sql`

**Interfaces:**
- Produces: tables `public.sale_payments(id uuid pk, business_id uuid not null, sale_id uuid not null references sales(id), method payment_method not null check (method <> 'split'), amount_fils bigint not null check (amount_fils > 0), reference text check (reference is null or (method = 'transfer' and char_length(reference) <= 60)), created_at timestamptz not null default now(), unique (sale_id, method))` and `public.credit_note_payments` with `credit_note_id` in place of `sale_id`. Index on `(business_id, created_at)` for each. Row security: select policies that mirror the existing sale and credit-note select policies (owner via `owns_business`; members via `member_sees_sale` on the parent sale, and the parent credit note's existing rule); no insert/update/delete policies. Backfill one row per existing sale and credit note: `(gen_random_uuid(), business_id, id, payment_method, gross_fils, null, created_at)`.

- [ ] **Step 1: Failing SQL tests** (two tenants, sales inserted the way `foundation_test.sql` does): after the migration a pre-existing sale has exactly one row equal to its method and gross; owner B cannot read A's rows; a cashier of A reads today's rows only; a direct insert as `authenticated` is refused; `method = 'split'` and `amount_fils = 0` violate checks; a second `cash` row for the same sale violates the unique key; `reference` on a `cash` row violates the check.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Write the migration. **Step 4:** Apply locally, `npm run test:sql` → all PASS.
- [ ] **Step 5:** Commit — `feat(payments): payment rows with row security and backfill (SQL)`.

### Task 3: Sync with payments (migration + route)

**Files:**
- Create: `supabase/migrations/202611090051_sync_with_payments.sql`
- Modify: `app/api/v1/sync/route.ts`, `lib/sync/request-schema.ts`
- Test: `supabase/tests/split_payment_test.sql`, `tests/sync-request.test.mjs`

**Interfaces:**
- Produces:
  - `apply_sale_sync_with_payments(p_operation_id uuid, p_business_id uuid, p_entity_id uuid, p_payload jsonb) returns void` and `apply_credit_note_sync_with_payments(...)` (same arguments), granted to `authenticated`, security definer. Each: read `payments` from `p_payload->'sale'` (or `'creditNote'`); if absent, build one row from `paymentMethod` and `grossFils`; validate per Global Constraints (raise `payments_mismatch` on any failure, including a summary method that does not match the row count); if the document already exists for this operation (retry), call nothing new and return; else `perform` the existing `apply_sale_sync` / `apply_credit_note_sync` with the same arguments, then insert the rows with the document's `business_id` and `created_at`. One function call = one transaction, so a failed insert rolls back the document.
  - Request schema: `paymentMethod` accepts `cash | card | transfer | split`; sales and credit notes accept optional `payments: { id: uuid, method: "cash" | "card" | "transfer", amountFils: int > 0, reference?: string (≤ 60) }[]` (1–3 items).
  - The sync route calls the `_with_payments` functions for `sale` and `credit-note` operations.

- [ ] **Step 1: Failing SQL tests:** a sale with payments `[cash 5000, card 2720]`, summary `split`, gross 7720 is saved with two rows; the same with card 2700 is refused `payments_mismatch` and no sale row exists; summary `cash` with two rows is refused; a sale without `payments` and method `transfer` gets one `transfer` row; the same operation sent twice leaves two rows, not four; a credit note with `[cash 1000, transfer 500 ref "TT-9"]` saves both with the reference.
- [ ] **Step 2: Failing unit test** in `tests/sync-request.test.mjs`: a sale operation with `payments` and `paymentMethod: "split"` parses and `rpcPayloadFor` keeps `payments`; a payment with method `split` or reference of 61 characters fails to parse.
- [ ] **Step 3:** Run both → FAIL. **Step 4:** Implement migration, schema and route.
- [ ] **Step 5:** `npm run test:sql`, `npm test`, `npm run typecheck` → PASS.
- [ ] **Step 6:** Commit — `feat(payments): sync saves payment rows with their sale or refund`.

### Task 4: Payment maths (pure)

**Files:**
- Create: `lib/payments/split.ts`
- Test: `tests/payments-split.test.mjs`

**Interfaces:**
- Produces:
  - `type PayMethod = "cash" | "card" | "transfer"`; `type Payment = { id: string; method: PayMethod; amountFils: number; reference?: string }`.
  - `paymentsOf(doc: { paymentMethod: string; grossFils: number; payments?: Payment[]; id: string }): Payment[]` — the doc's rows, or one row from `paymentMethod` (old caches).
  - `summaryMethod(payments: Payment[]): "cash" | "card" | "transfer" | "split"`.
  - `type SplitDraft = Partial<Record<PayMethod, number>>` (fils typed per line).
  - `splitSummary(totalFils: number, draft: SplitDraft, cashReceivedFils: number | null): { leftFils: number; changeFils: number | null; ok: boolean; error?: string }` — `ok` only when left is exactly 0, every used line > 0, and cash received ≥ the cash part when given.
  - `restOn(totalFils: number, draft: SplitDraft, method: PayMethod): SplitDraft` — sets `method` to what is left after the other lines; never ≤ 0 (unchanged draft when nothing is left).
  - `toPayments(draft: SplitDraft, reference: string | undefined, newId: () => string): Payment[]` — drops zero lines, trims reference to 60 and keeps it only on transfer.
  - `methodTotals(payments: Payment[]): Record<PayMethod, number>`.
  - `canSplit(features: string[]): boolean` — `features.includes("split_payment")`.

- [ ] **Step 1: Failing tests:** `splitSummary(7720, {cash:5000, card:2720}, 10000)` → `{leftFils:0, changeFils:5000, ok:true}`; with card 2700 → `leftFils:20, ok:false`; `restOn(7720, {cash:5000}, "card")` → `{cash:5000, card:2720}`; `restOn(7720, {cash:8000}, "card")` → unchanged; `toPayments({cash:5000, transfer:2720}, " x".repeat(40), gen)` → transfer reference length 60, cash has none; `paymentsOf` of an old sale `{paymentMethod:"card", grossFils:500}` → one card row of 500; `summaryMethod` of one row → its method, two → `split`; `canSplit(["staff_roles"])` → false.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit — `feat(payments): split payment maths`.

### Task 5: Domain, store, snapshot

**Files:**
- Modify: `lib/domain.ts` (`PaymentMethod` = `"cash" | "card" | "transfer" | "split"`; `Sale.payments?: Payment[]`; `CreditNote.payments?: Payment[]`), `lib/demo-store.ts`, `app/api/v1/snapshot/route.ts`, `lib/snapshot/types.ts`, `lib/snapshot/map-rows.ts`, `lib/lists/merge-results.ts`
- Test: `tests/snapshot-map.test.mjs`, `tests/payments-split.test.mjs`

**Interfaces:**
- Consumes: Task 4.
- Produces:
  - `completeSale(lines, payments: Payment[], customerId?, approvedByMemberId?)` — replaces the `paymentMethod` argument; sets `paymentMethod = summaryMethod(payments)` and `payments`. Every caller updated in Task 7.
  - `createCreditNote(saleId, quantities, payments: Payment[], found?, approvedByMemberId?)` — refund payments must sum to the credit note's gross (return an error otherwise).
  - Snapshot selects `sale_payments(id, method, amount_fils, reference)` and `credit_note_payments(...)` and maps them to `payments`.

- [ ] **Step 1: Failing tests:** `mapSnapshotRows` maps payment rows to camelCase `payments`; a row set without payments maps to `payments: undefined`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (snapshot route: add the embedded selects; read the route-handler docs first).
- [ ] **Step 4:** `npm test`, `npm run typecheck` → PASS (callers fixed in Task 7 may need a temporary single-payment adapter; leave none behind).
- [ ] **Step 5:** Commit — `feat(payments): sales and refunds carry payment rows`.

### Task 6: Register totals, reporting, lists, receipts

**Files:**
- Modify: `lib/store/register-totals.ts`, `lib/reporting.ts`, `components/receipt-document.tsx`, `components/sales-workspace.tsx`, `app/(dashboard)/overview/page.tsx`, `components/customer-detail-workspace.tsx`, `components/reports-workspace.tsx`, `app/api/v1/sales/search/route.ts` (method filter values)
- Create: `components/payments/method-badge.tsx`
- Test: `tests/register-totals.test.mjs`, `tests/payments-split.test.mjs` (reporting cases)

**Interfaces:**
- Consumes: `paymentsOf`, `methodTotals` (Task 4).
- Produces: `registerTotals` adds `transferSalesFils` and `transferReturnsFils`; `buildDailyReport` adds `transferSalesFils`, `transferReturnsFils`, and `ReportTransaction.paymentMethod` widens to the 4 values; CSV gains columns `transfer_sales` and `transfer_returns` after the existing ones; `<MethodBadge payments sale />` shows Cash / Card / Transfer / Split with parts in its `title`.

- [ ] **Step 1: Failing tests:** a register with sales `[cash 5000 + card 2720]` and `[transfer 1000]`, refund `[cash 1000]`, float 20000 → `expectedCashFils` 24000, `cardSalesFils` 2720, `transferSalesFils` 1000; an old cached sale without `payments` still counts by its method; the daily report's per-method totals equal the same sums; the CSV header starts with the previous columns unchanged.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement; receipts list each payment ("Cash 50.00 · Card 27.20 · Change 0.00", transfer with its reference).
- [ ] **Step 4:** `npm test`, typecheck, lint → PASS.
- [ ] **Step 5:** Commit — `feat(payments): register, reports, lists and receipts by payment`.

### Task 7: Payment windows (till)

**Files:**
- Modify: `components/pos/payment-dialog.tsx` (method `transfer` with reference), `components/pos-workspace.tsx` (F4, F6, buttons, Pro gate)
- Create: `components/pos/split-dialog.tsx`

**Interfaces:**
- Consumes: Task 4, `completeSale` (Task 5), `useEntitlement().hasFeature("split_payment")`, the 2A discount approval (runs before either window opens).

- [ ] **Step 1:** Build: Bank transfer button + F4 (all plans) completing with one transfer payment and its optional reference; Split button + F6 opening the Split window on Pro, the existing "Part of Pro" prompt on Starter; the Split window per spec §5.2 using `splitSummary`, `restOn`, `toPayments`; Complete calls `completeSale(lines, payments, …)`. Cash and Card keep their current flows but pass one-row `payments`.
- [ ] **Step 2:** `npm test`, typecheck, lint → PASS.
- [ ] **Step 3: Browser check** (local Supabase, a Pro shop): split 50.00 cash (100 handed over) + 27.20 card → change 50.00, receipt lists both, synced sale has two rows and summary `split`; a bank transfer with reference "TT-123" → one transfer row with the reference; on a Starter shop Split shows the Pro prompt and F4 works.
- [ ] **Step 4:** Commit — `feat(payments): bank transfer and split payment windows`.

### Task 8: Refund "Pay back by"

**Files:**
- Modify: `components/invoice-detail-workspace.tsx`
- Create: `components/payments/payback-fields.tsx`

**Interfaces:**
- Consumes: `createCreditNote(saleId, quantities, payments, …)` (Task 5), `canSplit` (Task 4).

- [ ] **Step 1:** "Pay back by" prefilled with the sale's summary method for the full refund (cash when the sale was a split). Pro: lines for cash, card and transfer, any mix adding up to the refund total; Starter: one method selector. Return is enabled only when the mix adds up.
- [ ] **Step 2:** Tests, typecheck, lint → PASS.
- [ ] **Step 3: Browser check:** refund one item of a split sale as 10.00 transfer + rest cash → credit note has two rows; the register's expected cash drops by the cash part only; Starter allows only one method.
- [ ] **Step 4:** Commit — `feat(payments): refunds paid back by any mix`.

### Task 9: End-to-end check, ledger, release notes

**Files:**
- Create: `docs/superpowers/plans/2026-11-09-stage-2b-ledger.md`
- Modify: `docs/RELEASE_CHECKLIST.md` (2B section: migrations 049–051 in order; the deployed app must ship with or after 051, because 051 changes which sync functions the route calls)

- [ ] **Step 1: Offline run on a production build** (`npm run build`, `npm start`, local API gateway stopped as in 2A): a split sale and a split refund offline, then reconnect and Sync now; check the rows, summaries and the register close.
- [ ] **Step 2:** `npm test`, `npm run test:sql`, `npm run typecheck`, `npm run lint`, `npm run build` → all PASS.
- [ ] **Step 3:** Write the ledger (decisions taken during the build, deferred minors) and the release section.
- [ ] **Step 4:** Commit — `docs: Stage 2B ledger and release notes`.
