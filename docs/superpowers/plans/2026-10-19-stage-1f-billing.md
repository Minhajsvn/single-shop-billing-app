# Stage 1F Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shop trials Pro for 14 days, pays for Starter (AED 99/month or 990/year + 5% VAT) through Stripe or a local pretend checkout, keeps selling through 7 days of grace after a failed payment, and becomes read-only — at the next register open, never mid-shift — when it stops paying.

**Architecture:** Stripe (or the dev-only pretend provider) produces events; one normaliser turns them into a `BillingEvent`; one service-role RPC `apply_billing_event` applies duplicates-ignored, order-checked transitions to `subscriptions` in one transaction. `entitlements_internal()` already derives `access`; it gains the trial-with-card rule and the new fields. A `register_sessions` insert trigger is the single server gate for read-only and paused tills (it covers the explicit open and the sessions sale/adjustment sync create implicitly). The client decides banners, the register stop screen and disabled writes from the cached entitlements via pure functions in `lib/billing/lifecycle-view.ts`.

**Tech Stack:** Next.js 16 route handlers (raw body via `await request.text()`), Supabase Postgres RPCs and triggers, `stripe` npm package (server only), zod, React 19, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-19-stage-1f-billing-design.md`

## Global Constraints

- Starter: `monthlyPriceMinor.AED = 9900`, `annualPriceMinor.AED = 99000`; prices exclusive of VAT; VAT 5% shown as 99.00 + 4.95 = 103.95 and 990.00 + 49.50 = 1,039.50. Annual label: "AED 990 / year (2 months free)".
- Stage 1 sells Starter only; Pro exists only as the 14-day trial.
- Grace: 7 days, set once per failure episode (`grace_ends_at = now() + interval '7 days'` only when not already past_due).
- Read-only is applied at register open only; an open register stays usable; the server accepts a session whose `openedAt` precedes the access end if it arrives within 72 hours of that end.
- Expired entitlement cache (offline > 72 h) is **not** read-only: last known entitlements apply, plus the "Connect to the internet to check your subscription." banner.
- Paying during the trial: Checkout passes `subscription_data.trial_end` = `trial_ends_at` (only when that is more than 48 hours away — Stripe's minimum; otherwise no trial and the charge is immediate). The shop stays trialing on Pro until then.
- Cancelling: `cancel_at_period_end`; access continues until `customer.subscription.deleted`.
- The pretend provider runs only when `NODE_ENV !== "production"` **and** Stripe keys are absent. Production without keys returns 503 "Billing is not set up yet."
- Stripe is "configured" when all of `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER_MONTHLY`, `STRIPE_PRICE_STARTER_ANNUAL` are set.
- Owner-only: checkout, portal, pretend actions, the Billing tab, choosing the till that stays. Cashiers see banners but no billing buttons.
- Secrets only in git-ignored `.env.local`; local Supabase only; never push migrations to the hosted project. Webhook/RPC writes use `SUPABASE_SERVICE_ROLE_KEY` (local value from `supabase status`), server only.
- Copy (exact):
  - past_due owner: "Payment failed. Your card was declined. Update it within N days to keep selling." + "Update card"
  - past_due cashier: "Payment failed. Ask the shop owner to update the card within N days. Sales continue as normal."
  - read-only owner: "Read-only. Sales are paused. Invoices, reports and exports still work." + "Choose a plan"; cashier: same first two sentences + "Ask the shop owner to renew."
  - stale: "Connect to the internet to check your subscription."
  - trial (owners, from day 10): "Pro trial · N days left · Choose a plan"
  - stop screen: title "Your shop is read-only", body "The subscription has ended. You can still view, print and export everything.", buttons "Choose a plan" (owner) and "View sales and reports".
  - "N days" = Dubai calendar days; 0 days reads "today" (e.g. "Update it today").
- Tests: `node --experimental-strip-types --test tests/*.test.mjs`; tested modules use relative `.ts` imports. SQL tests go in `supabase/tests/foundation_test.sql` before the final `rollback;`.

## Review Focus

1. **A shift that crosses the deadline offline** (register opened on day 14 at 09:00, trial ends 12:00, sync at 18:00): every sale and the close are accepted; the next open is refused. — Task 3 SQL test `24c`.
2. **A replayed or older webhook after payment** (payment_failed delivered again, or an older `subscription.updated` arriving after `invoice.paid`): the subscription stays active. — Task 2 SQL test `24a` (duplicate id, older `created`).
3. **The $0 trial invoice Stripe sends at checkout with a trial**: it must not turn the trial into active Starter early. — Task 5 test `zero-amount trial invoice is ignored`.
4. **This browser's till is the one paused** while its register is open: the shift finishes, sales sync, and the till picker does not pop up mid-shift. — Task 3 SQL test `24d` + Task 7 browser check.
5. **A cashier** never sees "Update card", "Choose a plan", the Billing tab, or reaches `/api/v1/billing/*` (403). — Task 5 route test + Task 8 browser check.

---

### Task 1: Prices and billing environment

**Files:**
- Modify: `lib/billing/plans.ts`
- Test: `tests/plans.test.mjs`
- Modify: `.env.local` (git-ignored; add `SUPABASE_SERVICE_ROLE_KEY` from `supabase status`, local value only), `.env.example` if present (names only)

**Interfaces:**
- Produces: `Plan.annualPriceMinor: { AED: number; SAR: number } | null`; `STARTER_VAT_RATE = 0.05`; `priceWithVat(minor: number): { netMinor: number; vatMinor: number; grossMinor: number }`.

- [ ] **Step 1: Failing test** `starter costs 99 a month and 990 a year before VAT`:
  ```js
  assert.equal(PLANS.starter.monthlyPriceMinor.AED, 9900);
  assert.equal(PLANS.starter.annualPriceMinor.AED, 99000);
  assert.deepEqual(priceWithVat(9900), { netMinor: 9900, vatMinor: 495, grossMinor: 10395 });
  assert.deepEqual(priceWithVat(99000), { netMinor: 99000, vatMinor: 4950, grossMinor: 103950 });
  ```
- [ ] **Step 2:** Run `npm test`. Expected: FAIL (7900 / `annualPriceMinor` undefined).
- [ ] **Step 3:** Update `plans.ts` (Starter 9900/99000; other plans' `annualPriceMinor` = 10 × monthly, Enterprise null); add `priceWithVat` (VAT rounded half-up to the fil).
- [ ] **Step 4:** Run `npm test`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** `npm install stripe` (exact version pinned, no caret). Commit `feat(billing): Starter at AED 99 / 990 before VAT; stripe dependency`.

### Task 2: Subscription lifecycle RPC and entitlements fields

**Files:**
- Create: `supabase/migrations/202610190023_billing_lifecycle.sql`
- Modify: `supabase/tests/foundation_test.sql` (section 24a–24b)
- Modify: `lib/billing/entitlements.ts`; Test: `tests/entitlements.test.mjs`

**Interfaces:**
- Produces (SQL):
  - `subscriptions` gains `has_payment_method boolean not null default false`, `billing_interval text check (billing_interval in ('month','year'))`, `cancel_at timestamptz`, `canceled_at timestamptz`, `last_event_at timestamptz`.
  - `public.access_ends_at(sub public.subscriptions) returns timestamptz` (immutable-ish helper): trialing without payment method → `trial_ends_at`; trialing with payment method → `trial_ends_at + interval '2 days'`; past_due → `grace_ends_at`; canceled → `coalesce(canceled_at, '-infinity')`; active → null.
  - `entitlements_internal` uses `access_ends_at`: `access = 'full'` iff end is null or end > at_time. JSON adds `accessEndsAt`, `cancelAt`, `hasPaymentMethod`, `billingInterval`.
  - `public.apply_billing_event(p_event jsonb) returns text` — security definer, `search_path = public, extensions, pg_temp`, execute granted to `service_role` only. Returns `'applied' | 'duplicate' | 'stale' | 'unknown_business'`.
- Produces (TS): `Entitlements` gains `accessEndsAt: string | null`, `cancelAt: string | null`, `hasPaymentMethod: boolean`, `billingInterval: "month" | "year" | null` — all `.default(...)` in zod so caches written before 1F still parse.
- `BillingEvent` JSON accepted by the RPC (Task 5 produces it):
  `{ id, created (ISO), kind: "checkout_completed"|"subscription_changed"|"subscription_deleted"|"invoice_paid"|"payment_failed", businessId|null, customerId|null, subscriptionId|null, status|null, trialEnd|null, currentPeriodEnd|null, cancelAt|null, interval: "month"|"year"|null }`

**Transitions** (apply under `select … for update`; business resolved by `businessId`, else `stripe_subscription_id`, else `stripe_customer_id`):
1. `insert into stripe_events (id, type)` `on conflict do nothing`; nothing inserted → `'duplicate'`.
2. `last_event_at > created` → `'stale'` (event id stays recorded). Otherwise set `last_event_at = created`.
3. `checkout_completed`: store customer/subscription ids, `has_payment_method = true`, `billing_interval`. If status trialing and `trial_ends_at > now()` → stays trialing (plan pro). Else → `active`, plan `starter`, `grace_ends_at = null`, `canceled_at = null`.
4. `subscription_changed`: Stripe status `trialing` → keep trialing; `active` → active/starter, grace null; `past_due`/`unpaid` → past_due with grace set once; always store `current_period_end`, `cancel_at`, `billing_interval`.
5. `invoice_paid` → active/starter, grace null, `current_period_end`.
6. `payment_failed` → past_due; `grace_ends_at = case when status = 'past_due' then grace_ends_at else now() + interval '7 days' end`.
7. `subscription_deleted` → canceled, `canceled_at = created`, `cancel_at = null`.

- [ ] **Step 1: Failing SQL tests (section 24a–24b)**, as `service_role`:
  - 24a: trial business; `checkout_completed` with trial still running → status trialing, plan pro, `has_payment_method`; `invoice_paid` → active starter; `payment_failed` → past_due, grace ≈ now+7d; second `payment_failed` (new id) → grace unchanged; same event id again → `'duplicate'`; `subscription_changed` with `created` earlier than the last → `'stale'` and status unchanged; `invoice_paid` → active, grace null; `subscription_deleted` → canceled.
  - 24b: `entitlements_internal` → access full for trial-with-card one day after `trial_ends_at`, read_only three days after; read_only for canceled; full for past_due before grace end, read_only after; `accessEndsAt` equals `grace_ends_at` for past_due; `authenticated` cannot execute `apply_billing_event` (expect `42501`).
- [ ] **Step 2:** `supabase db reset; npm run test:sql`. Expected: FAIL (function does not exist).
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** `supabase db reset; npm run test:sql`. Expected: PASS.
- [ ] **Step 5: Failing TS test** `old cached entitlements without 1F fields still parse` (parse a 1A-shaped object → `hasPaymentMethod === false`, `accessEndsAt === null`); run (FAIL), extend the zod schema, run (PASS). `READ_ONLY_ENTITLEMENTS` gets the new fields.
- [ ] **Step 6:** Commit `feat(billing): lifecycle RPC with duplicate and out-of-order protection; access end in entitlements`.

### Task 3: Server gate at register open; paused tills

**Files:**
- Create: `supabase/migrations/202610190024_register_access_gate.sql`
- Modify: `supabase/tests/foundation_test.sql` (24c–24e)

**Interfaces:**
- Produces (SQL):
  - `alter type public.device_status add value 'paused'` (in its own migration statement before use; if the enum add cannot share a transaction with its use, split into `…0024a` and `…0024b`).
  - Trigger `register_access_gate` BEFORE INSERT on `public.register_sessions`: raise `P0001 'till_paused'` when the session's device is paused; raise `P0001 'read_only'` when `access_ends_at` is not null, `now() > end`, and (`new.opened_at >= end` or `now() > end + interval '72 hours'`).
  - `sync_device_id`: an explicitly requested device is accepted when status is `active` **or** `paused` (fallback selection stays active-only).
  - `public.choose_active_till(p_business_id uuid, p_keep_device_id uuid) returns integer` (owner only, `42501` otherwise; keeps the chosen device active, sets the business's other active devices to `paused`, returns how many were paused; raises `till_not_found` if the kept device is not active in that business).
  - Sync RPCs surface `read_only` / `till_paused` as failed operations with those messages (they already turn `P0001` messages into failures — verify, don't rewrite).

- [ ] **Step 1: Failing SQL tests:**
  - 24c (Review Focus 1): trial ends at `now() - 6 hours`; `apply_register_sync('open')` with `openedAt = now() - 9 hours` → accepted; a sale on that session → accepted; `close` → accepted; a new `open` with `openedAt = now() - 1 hour` → fails `read_only`; a sale whose sync creates a session implicitly with `openedAt = now()` → fails `read_only`; same backdated `openedAt` arriving 73 hours after the end (set trial end to `now() - 73 hours`) → `read_only`.
  - 24d (Review Focus 4): two active tills; till B has an open session; owner calls `choose_active_till(keep A)` → returns 1, B paused; a sale and the close for B's open session → accepted; a new open on B → `till_paused`; creating a third device stays limited by `enforce_plan_limit` counting active tills only.
  - 24e: a cashier calling `choose_active_till` → `42501`.
- [ ] **Step 2:** `supabase db reset; npm run test:sql`. Expected: FAIL.
- [ ] **Step 3:** Write the migration(s).
- [ ] **Step 4:** `supabase db reset; npm run test:sql; npm run test:rehearsal`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(billing): read-only and paused-till gate at register open on the server`.

### Task 4: Lifecycle view (pure) and the role in the snapshot

**Files:**
- Create: `lib/billing/lifecycle-view.ts`; Test: `tests/billing-view.test.mjs`
- Modify: `lib/store/hosted.ts` (`effectiveEntitlements`), `lib/snapshot/types.ts`, `lib/snapshot/map-rows.ts`, `app/api/v1/snapshot/route.ts`, `lib/demo-store.ts` (context), `tests/hosted-store.test.mjs`, `tests/snapshot-map.test.mjs`

**Interfaces:**
- Produces:
  - `ShopContext.role: "owner" | "manager" | "cashier" | null` (snapshot selects `business_members.role`; sample/unconfigured → `"owner"`); `ShopContext.entitlementsStale: boolean`.
  - Snapshot devices include `paused` ones; `TillDevice.status: "active" | "paused" | "revoked"`; `ShopContext.device` matches this browser's device when `active` or `paused`.
  - `effectiveEntitlements(cache, now)` returns `{ entitlements, stale }`: no cache → `READ_ONLY_ENTITLEMENTS, stale: true`; expired → cached entitlements, `stale: true`; else `stale: false`.
  - `dubaiDaysLeft(endIso: string, now: Date): number` (Dubai calendar days, ≥ 0).
  - `type LifecycleState = "full" | "trial" | "grace" | "read_only"` and `lifecycleState(e: Entitlements, now: Date): LifecycleState` — read-only when `accessEndsAt` ≤ now (device clock) or `access === "read_only"`; grace when past_due; trial when trialing.
  - `bannerFor(input: { e: Entitlements; stale: boolean; role: Role; now: Date }): { tone: "red" | "yellow" | "grey"; text: string; action: "update_card" | "choose_plan" | null } | null` — priority read_only > grace > stale > trial (trial only for owners and only when `dubaiDaysLeft ≤ 4`, i.e. from day 10 of 14; not shown when `hasPaymentMethod`).
  - `registerOpenDecision(input: { e; stale; device: TillDevice | null; activeTills: number; registerOpen: boolean; now }): "allow" | "read_only" | "till_paused" | "choose_till"` — `registerOpen` → always `"allow"` (never mid-shift); read-only → `"read_only"`; this device paused → `"till_paused"`; `activeTills > e.limits.tills` → `"choose_till"`; else `"allow"`. A stale cache alone never blocks.
  - `canWrite(state: LifecycleState, registerOpen: boolean): boolean` — false only when read-only and no register is open.

- [ ] **Step 1: Failing tests** in `tests/billing-view.test.mjs` with the spec's exact copy:
  - `past_due owner banner counts Dubai days` → yellow, "Payment failed. Your card was declined. Update it within 5 days to keep selling.", action `update_card`; cashier text and `action: null`; last day → "Update it today".
  - `read-only beats every other banner`; `stale shows the connect banner but does not block` (`registerOpenDecision` → `"allow"`); `trial line only for owners from day 10`; `no trial line once a card is on file`.
  - `an open register is never stopped` (read-only + `registerOpen: true` → `"allow"`; `canWrite("read_only", true) === true`).
  - `trial end reached on the device clock is read-only even if the cache says full` (cached `access: "full"`, `accessEndsAt` in the past).
  - `two active tills on Starter ask the owner to choose`; `a paused till cannot open`.
  - `expired cache keeps the last entitlements` (hosted-store test).
- [ ] **Step 2:** `npm test`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement; update `effectiveEntitlements` callers (`buildContext`); snapshot role and paused devices (update `snapshot-map` test fixture).
- [ ] **Step 4:** `npm test; npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(billing): lifecycle view, stale entitlements kept, member role in the shop context`.

### Task 5: Stripe normaliser, provider, webhook, checkout and portal routes

**Files:**
- Create: `lib/billing/stripe-events.ts`, `lib/billing/provider.ts`, `lib/billing/apply-event.ts`, `lib/supabase/admin.ts`
- Create: `app/api/v1/billing/webhook/route.ts`, `app/api/v1/billing/checkout/route.ts`, `app/api/v1/billing/portal/route.ts`
- Create: `tests/fixtures/stripe/*.json` (recorded event shapes: `checkout.session.completed`, `customer.subscription.updated` (active, past_due, cancel_at_period_end), `customer.subscription.deleted`, `invoice.paid` (amount 0 trial and 9900), `invoice.payment_failed`) — no real ids or keys.
- Test: `tests/billing-stripe.test.mjs`

**Interfaces:**
- Consumes: `apply_billing_event` (Task 2), `BillingEvent` shape.
- Produces:
  - `normalizeStripeEvent(event: { id: string; type: string; created: number; data: { object: any } }): BillingEvent | null` — business id from `client_reference_id` or `metadata.business_id` (checkout session, subscription); interval from the price's `recurring.interval`; `invoice.paid` with `amount_paid === 0` → `null`; unknown types → `null`.
  - `billingProvider(env = process.env): { kind: "stripe" | "pretend" | "none"; startCheckout(input: { businessId: string; customerId: string | null; interval: "month" | "year"; trialEndsAt: string | null; origin: string }): Promise<string>; openPortal(input: { customerId: string; origin: string }): Promise<string> }` — `pretend` only when `NODE_ENV !== "production"` and Stripe not configured; pretend URLs are `/billing/pretend?interval=…` and `/billing/pretend/portal`.
  - `applyBillingEvent(event: BillingEvent): Promise<"applied" | "duplicate" | "stale" | "unknown_business">` (admin client → RPC).
  - `createAdminClient()` in `lib/supabase/admin.ts` — reads `SUPABASE_SERVICE_ROLE_KEY`; throws if missing; never imported by client code.
  - Routes: webhook `POST` (400 on bad signature, 200 `{ result }` otherwise, 200 for ignored types); checkout `POST { interval }` → `{ url }`; portal `POST` → `{ url }` (409 when no customer); both owner-only (403 otherwise), 503 "Billing is not set up yet." when `kind === "none"`.
  - Checkout (Stripe): `mode: "subscription"`, price by interval, `client_reference_id` + `subscription_data.metadata.business_id`, `customer` when known, `automatic_tax: { enabled: true }`, `subscription_data.trial_end` per Global Constraints, success `/settings?tab=billing&checkout=success`, cancel `/settings?tab=billing&checkout=cancel`.

- [ ] **Step 1: Failing tests:**
  - `normalises the checkout session with its business id`; `subscription past_due becomes subscription_changed with status past_due`; `cancel_at_period_end keeps the cancel date`; `zero-amount trial invoice is ignored` (Review Focus 3); `unknown event types are ignored`.
  - `webhook signature: a fixture signed with the test secret verifies; a tampered body fails` (use `stripe.webhooks.generateTestHeaderString` with a throwaway secret created in the test).
  - `provider: pretend without keys in development, none in production, stripe when all four variables are set`.
  - `trial_end is passed only when the trial has more than 48 hours left`.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement the modules and routes (read `node_modules/next/dist/docs` on route handlers first; webhook reads `await request.text()`).
- [ ] **Step 4:** `npm test; npm run typecheck; npm run lint`. Expected: PASS. Browser/curl check: a cashier session gets 403 from checkout and portal (Review Focus 5).
- [ ] **Step 5:** Commit `feat(billing): Stripe webhook, checkout and portal behind one provider`.

### Task 6: Pretend checkout and portal (development only)

**Files:**
- Create: `app/billing/pretend/page.tsx`, `app/billing/pretend/portal/page.tsx`, `app/api/v1/billing/pretend/route.ts`, `lib/billing/pretend-events.ts`; Test: `tests/billing-stripe.test.mjs` (pretend section)

**Interfaces:**
- Consumes: `applyBillingEvent`, `billingProvider`, `priceWithVat`.
- Produces: `pretendEvent(action: PretendAction, ctx: { businessId: string; interval: "month" | "year"; now: Date; trialEndsAt: string | null }): BillingEvent[]` with `PretendAction = "pay" | "decline" | "update_card" | "cancel" | "fail_renewal" | "end_trial" | "end_grace" | "renew"`. Ids `pretend_<uuid>`; customer/subscription ids `pretend_cus_<businessId>` / `pretend_sub_<businessId>`.
  - `pay` → `checkout_completed`; `decline` → none (checkout page shows "Card declined. Nothing was charged."); `update_card` → `invoice_paid`; `cancel` → `subscription_changed` with `cancelAt = current period end`, and a later `renew` then emits `subscription_deleted`; `fail_renewal` → `payment_failed`; `end_trial` → moves `trial_ends_at` to now (dev-only admin update) and, when a card is on file, emits `invoice_paid`; `end_grace` → moves `grace_ends_at` to now; `renew` → `invoice_paid` (or `subscription_deleted` if cancelling).
- Route `POST /api/v1/billing/pretend { action, interval }`: 404 unless provider kind is `pretend`; owner only.
- Pages show plan, interval, "AED 99.00 + VAT 4.95 = AED 103.95" (annual: 990.00 + 49.50 = 1,039.50), the "Test billing — no real charges" badge, and return to `/settings?tab=billing&checkout=success|cancel`.

- [ ] **Step 1: Failing tests:** `pay during the trial emits checkout_completed only`; `fail_renewal emits payment_failed`; `cancel then renew emits subscription_deleted`; `pretend route is unavailable in production` (provider kind `none` → 404).
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test; npm run typecheck; npm run lint`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(billing): local pretend checkout and portal for development`.

### Task 7: Banner, stop screen, till choice, gated writes

**Files:**
- Create: `components/billing/use-entitlement.ts`, `components/billing/feature-gate.tsx`, `components/billing/lifecycle-banner.tsx`, `components/billing/register-stop.tsx`, `components/billing/choose-till.tsx`
- Modify: `components/app-shell.tsx` (banner slot under the top bar), `components/register-workspace.tsx` (decision before the open dialog), `components/pos-workspace.tsx` (New sale when read-only without an open register shows the stop card), `components/till-picker.tsx` (paused tills listed disabled "Paused — upgrade to use"), write actions in `inventory-workspace.tsx`, `customers-workspace.tsx`, `invoice-detail-workspace.tsx` (refund), catalogue import, `app/globals.css`

**Interfaces:**
- Consumes: Task 4 functions; `ShopContext.role`, `entitlementsStale`.
- Produces: `useEntitlement(): { e: Entitlements; stale: boolean; state: LifecycleState; hasFeature(key: FeatureKey): boolean; canWrite: boolean }`; `<FeatureGate feature>` (Pro features not built → "Coming soon"); `<LifecycleBanner />`; `<RegisterStop decision />`; `<ChooseTill />` (owner: radio list of active tills → `choose_active_till` RPC → refresh snapshot; cashier: "Ask the shop owner to choose which till stays.").
- Disabled write actions carry `title`/inline reason "Read-only — sales and edits are paused." Export, print, search and backup download stay enabled.

- [ ] **Step 1: Browser RED** (local owner, pretend provider): with the trial ended via SQL, opening the register still succeeds (no stop screen) — confirms nothing enforces read-only yet.
- [ ] **Step 2:** Implement.
- [ ] **Step 3: Verify in the browser:** owner and cashier banners for past_due (cashier via a second local member, credentials in `.env.local` only); stop screen with both buttons at register open; an already-open register keeps selling after access ends (Review Focus 1, client side); two tills → choose-till card at register open, choosing keeps this browser's shift running when this till is paused (Review Focus 4); phone 375px: banner wraps, no horizontal scroll.
- [ ] **Step 4:** `npm run lint; npm run typecheck; npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(billing): lifecycle banners, read-only stop screen at register open, choose the till that stays`.

### Task 8: Billing tab

**Files:**
- Modify: `app/(dashboard)/settings/page.tsx` (tab `billing`, owners only; hidden for cashiers), `components/nav/more-sheet.tsx` if it lists Settings sections
- Create: `components/billing/billing-panel.tsx`; Test: `tests/billing-view.test.mjs` (`billingSummary`)

**Interfaces:**
- Produces: `billingSummary(e: Entitlements, now: Date): string` in `lifecycle-view.ts`:
  - trialing, no card → "Pro trial · N days left"; trialing with card → "Pro trial · N days left · Starter starts <d MMM>"
  - active → "Starter · monthly · renews <d MMM yyyy>" (or "annual"); with `cancelAt` → "Starter · cancels on <d MMM yyyy>"
  - past_due → "Payment failed · grace ends <d MMM>"; read-only → "Read-only since <d MMM>"
- Panel: summary, price with VAT for the chosen interval (monthly/annual toggle), **Choose a plan** (trialing without card, or read-only) → checkout URL; **Manage billing** when `hasPaymentMethod` → portal URL; `checkout=success` → refresh entitlements + snapshot, toast "Payment received", then remove the param; `checkout=cancel` → nothing; pretend → "Test billing — no real charges" badge; provider none → "Billing is not set up yet."

- [ ] **Step 1: Failing tests** for each `billingSummary` line above with fixed dates (e.g. now 2026-10-19T08:00Z, trial end 2026-10-25 → "Pro trial · 6 days left").
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test; npm run typecheck; npm run lint`. Browser: tab visible to the owner at `?tab=billing`, absent for the cashier (Review Focus 5).
- [ ] **Step 5:** Commit `feat(billing): Billing tab with plan, price with VAT, checkout and portal`.

### Task 9: End-to-end smoke and the full suite

**Files:** none unless a defect is found (each fix: failing test or browser RED first, `fix:` commit).

- [ ] **Step 1: Setup:** `supabase db reset`; local owner (credentials in `.env.local` only); a local cashier member; dev server on 3101; clear only `sb-127-*` cookies and the 3101 origin's storage; set up the shop, register two tills during the trial, open the register.
- [ ] **Step 2: Lifecycle with the pretend provider**, recording each result:
  1. Trial: owner line appears when ≤ 4 days are left (set `trial_ends_at` via SQL); Billing tab "Pro trial · N days left".
  2. Choose a plan → pretend Pay (monthly) → back with "Payment received"; still Pro trial with "Starter starts <date>".
  3. Pretend **End trial** → active Starter; register open on either till shows Choose till; keep till 1 → till 2 paused (its open shift finishes and syncs).
  4. **Fail renewal** → yellow banner (owner with Update card; cashier text); selling continues.
  5. **End grace** → current shift keeps selling; close register; reopen → stop screen; Sales, Reports, print and CSV export still work; New sale shows the stop card.
  6. **Update card** → active; register opens normally.
  7. **Cancel** → "Starter · cancels on <date>"; **Renew** → canceled → read-only at next open.
  8. Offline (stubbed) with an expired cache → "Connect to the internet to check your subscription.", register opens.
  9. Cashier: no Billing tab, no billing buttons, `/api/v1/billing/checkout` → 403.
- [ ] **Step 3:** Run `npm test`, `npm run test:sql`, `npm run test:rehearsal`, `npm run lint`, `npm run typecheck`, then stop the dev server and `npm run build`. Expected: all pass. Record `1F smoke passed`.
