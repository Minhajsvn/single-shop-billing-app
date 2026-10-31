# Stage 1J — Razorpay billing and public pages: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** replace Stripe with Razorpay end to end (checkout window, webhook, update card, cancel, billing check, admin)
and add the public pages Razorpay's approval needs.

**Architecture:**
- The provider-neutral pieces stay: the `BillingEvent` JSON, the `apply_billing_event` RPC, the pretend provider
  and the `billingProvider()` switch.
- Razorpay arrives as a new provider and a new event normalizer. Stripe's provider and normalizer are deleted.
- One migration renames the Stripe columns and table to neutral names and recreates the RPCs that use them.
- Public pages are plain server components behind an allowlist in the route rules.

**Tech stack:** Next.js 16 (App Router, `proxy.ts`), Supabase (Postgres RPCs, local only), Node test runner
(`node --test`, `.mjs`), Razorpay REST API via `fetch`, Razorpay Checkout script.

**Spec:** `docs/superpowers/specs/2026-10-31-stage-1j-razorpay-design.md` (read it first; section numbers below refer to
it).

## Global Constraints

- Local Supabase only. Never push to the hosted project or call it. Secrets go only in the git-ignored `.env.local`.
- Next.js 16: read the relevant guide in `node_modules/next/dist/docs/` before writing a route, page or header config.
- No new runtime dependencies. Remove `stripe` from `package.json` (and the lockfile via `npm uninstall stripe`).
- Automated tests make no real Razorpay calls; recorded Razorpay-shaped payloads only (`tests/fixtures/razorpay/`).
- Prices: Starter `9900` fils a month and `99000` fils a year, charged as is. No VAT line on the subscription anywhere.
- Copy: "Billing is not set up yet." (`BILLING_NOT_SET_UP`) is unchanged. The annual price reads
  "AED 990 / year (2 months free)".
- Server variables: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`,
  `RAZORPAY_PLAN_STARTER_MONTHLY`, `RAZORPAY_PLAN_STARTER_ANNUAL`. None of them may be `NEXT_PUBLIC_`.
- Placeholders: `[LEGAL BUSINESS NAME]`, `[REGISTERED ADDRESS]`, `[SUPPORT EMAIL]`, `[PHONE]`.
- Test commands:
  - `npm test` runs the unit tests;
  - `npm run test:sql` runs the SQL tests and needs local Supabase running and `.env.local`;
  - `npm run typecheck` and `npm run lint` must both be clean at the end of every task.
- When a task finishes, no file outside `docs/` mentions Stripe, except files that later tasks own.

## Review Focus

1. **Stray subscription events.** An owner opens checkout, abandons it, then pays a second time. Any event for the
   first subscription must never change the shop. Owner of the guard: Task 1, test 28c.
2. **Double payment from two tabs.** Two tabs each create a subscription and the owner pays both. The second one
   must be cancelled on Razorpay at once, not left charging with no shop record. Owner: Task 3, test
   `webhook cancels a superseded subscription`.
3. **Cancel pressed twice, or pressed while a cancel is already pending.** Expected: one cancel call and a clear
   "This subscription already ends on <date>." answer. Owner: Task 3.
4. **Owner cancels a card-saved trial.** The shop keeps its remaining trial days and is offered "Choose a plan"
   again, never read-only. Owner: Task 1 (RPC) and Task 3 (route).
5. **Placeholder business details left with live keys set.** Billing must show "not set up" until they are filled
   in, in every environment. Owner: Task 3, provider-selection tests.

---

### Task 1: Neutral billing names in the database and the lifecycle RPC

**Files:**
- Create: `supabase/migrations/202610310043_razorpay_billing.sql`
- Modify:
  - `supabase/tests/foundation_test.sql`: rename references, add tests 28a–28e;
  - `lib/admin/shops.ts`, `lib/admin/billing-check-run.ts`, `lib/billing/owner-session.ts`;
  - `lib/billing/provider.ts`: only the pretend `select` / `.eq` column names;
  - `lib/admin/actions.ts`: error-code copy key;
  - every component that reads `stripeCustomerId` / `stripeSubscriptionId`.

**Interfaces:**
- Produces, in SQL:
  - columns `subscriptions.billing_customer_id` and `subscriptions.billing_subscription_id`;
  - table `public.billing_events (id text primary key, type text, …)`, the renamed `stripe_events`;
  - `apply_billing_event(p_event jsonb)` accepts a new kind, `'trial_card_removed'`, and returns
    `'applied' | 'duplicate' | 'stale' | 'unknown_business' | 'superseded'`;
  - `record_billing_cancel(p_business uuid, p_cancel_at timestamptz, p_actor uuid) returns void`, service role only;
  - `admin_grant_plan` raises `billing_subscription_live` where it raised `stripe_subscription_live`.
- Produces, in TS: `AdminShopDetail.billingCustomerId` and `billingSubscriptionId`, replacing `stripe…`.
  `OwnerBilling` keeps its `customerId` and `subscriptionId` names.

- [ ] **Step 1: Write the failing SQL tests**

  In `foundation_test.sql`, rename every `stripe_customer_id` → `billing_customer_id`, `stripe_subscription_id` →
  `billing_subscription_id`, `stripe_events` → `billing_events`, and `stripe_subscription_live` →
  `billing_subscription_live`. Then add:
  - **28a. No public function mentions Stripe:**
    `assert not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and pg_get_functiondef(p.oid) ilike '%stripe%')`.
  - **28b. `trial_card_removed`:**
    - set-up: a trialing shop with a card (`has_payment_method = true`, ids set) and `trial_ends_at = now() + 5 days`;
    - result: `applied`;
    - the row is `status = 'trialing'`, `plan_id = 'pro'`, `has_payment_method = false`, both ids null,
      `cancel_at` null, and `trial_ends_at` unchanged.
  - **28c. Stray subscription:**
    - set-up: an active shop with `billing_subscription_id = 'sub_A'`;
    - a `subscription_deleted`, `payment_failed` or `invoice_paid` event for `'sub_B'` (with the shop's businessId)
      returns `stale`;
    - the row is unchanged.
  - **28d. Superseded:**
    - set-up: an active shop with `sub_A`;
    - a `checkout_completed` for `sub_B` returns `superseded`;
    - the row keeps `sub_A`; the event id is recorded in `billing_events`.
  - **28e. `record_billing_cancel`:**
    - it sets `cancel_at`; with `p_cancel_at` null (trial card removed) it still writes the audit row;
    - it writes one `audit_events` row with action `billing.cancel` and `summary->>'cancel_at'`;
    - it is not executable by `authenticated`: `has_function_privilege('authenticated', …, 'execute')` is false.

- [ ] **Step 2: Run the SQL tests and check they fail**

  Run: `npm run test:sql`
  Expected: FAIL, because the column `billing_customer_id` does not exist.

- [ ] **Step 3: Write the migration**

  1. `alter table … rename column`, twice, and `alter table public.stripe_events rename to billing_events`.
  2. Recreate `apply_billing_event` in full with the new names: the body of `202610200027` plus the `trial_ends_at`
     line from `202610250037`, with these changes:
     - add `'trial_card_removed'` to the kind list;
     - after the canceled-is-final guard, add:
       - when `sub.billing_subscription_id is not null and v_subscription is not null and v_subscription <> sub.billing_subscription_id`:
         return `'superseded'` if `v_kind = 'checkout_completed' and sub.status in ('active','past_due') or (sub.status = 'trialing' and sub.has_payment_method)`,
         else return `'stale'`;
       - otherwise fall through. A `checkout_completed` for a new id when the stored row is canceled, or is a
         trialing row without a card, is applied and relinks the ids, as today.
     - the `trial_card_removed` branch: `status = 'trialing', plan_id = 'pro', has_payment_method = false, billing_customer_id = null, billing_subscription_id = null, cancel_at = null`.
  3. Recreate `billing_check_shops` (from `202610250036`) and `admin_grant_plan` (from `202610290040`) with the new
     column name and the new error code.
  4. Add `record_billing_cancel`: `security definer`, revoked from public, anon and authenticated, granted to
     service role. Audit row: `actor = p_actor`, `action = 'billing.cancel'`,
     `summary = jsonb_build_object('cancel_at', p_cancel_at)`. Follow the shape of the existing admin audit inserts
     in `202610250035`.

- [ ] **Step 4: Rename in TypeScript**

  - Replace the column strings and the `stripe…` field names in the files listed above.
  - Map `billing_subscription_live` in `lib/admin/actions.ts` to the same copy the old code used.
  - Leave `lib/billing/stripe-events.ts` for Task 2.

- [ ] **Step 5: Run the tests and check they pass**

  Run: `npx supabase db reset`, then `npm run test:sql`, `npm test`, `npm run typecheck`
  Expected: all pass. `git grep -n "stripe_customer_id\|stripe_subscription_id\|stripe_events" -- lib app components`
  prints nothing.

- [ ] **Step 6: Commit**

  `git commit -m "feat(billing): neutral billing names; lifecycle ignores stray subscriptions and frees a trial card"`

---

### Task 2: Razorpay events and the webhook

**Files:**
- Create:
  - `lib/billing/events.ts`: `BillingEventKind`, `BillingInterval` and `BillingEvent`, moved from
    `stripe-events.ts`;
  - `lib/billing/razorpay-events.ts`;
  - `tests/fixtures/razorpay/*.json`;
  - `tests/billing-razorpay.test.mjs`.
- Modify: `app/api/v1/billing/webhook/route.ts`, `lib/billing/apply-event.ts` (import path; `superseded` result),
  `lib/billing/pretend-events.ts` (import path).
- Delete: `tests/fixtures/stripe/`, `tests/billing-stripe.test.mjs`. `stripe-events.ts` is deleted in Task 3, once the
  provider stops importing `subscriptionSnapshot`.

**Interfaces:**
- Produces:
  - `type RazorpayWebhook = { event: string; created_at: number; payload: { subscription?: { entity: Obj }; payment?: { entity: Obj } } }`;
  - `verifyRazorpaySignature(rawBody: string, signature: string | null, secret: string): boolean`, an HMAC-SHA256 hex
    compared with `crypto.timingSafeEqual` (false on a length mismatch or a missing header);
  - `normalizeRazorpayEvent(eventId: string, body: RazorpayWebhook): BillingEvent | null`;
  - `subscriptionSnapshot(entity: Obj): ProviderSubscription`, which Task 3 consumes;
  - `ApplyResult` gains `"superseded"`, and `webhookStatus("superseded") === 200`.
- `BillingEvent` fields come from `payload.subscription.entity`:
  - `id` is the event id;
  - `created` is `created_at`, as ISO;
  - `businessId` is `notes.business_id`, else null;
  - `customerId` is `customer_id`;
  - `subscriptionId` is `id`;
  - `interval` is `notes.interval` when it is `"month"` or `"year"`;
  - `currentPeriodEnd` is `current_end`, as ISO;
  - `trialEnd` is `start_at`, as ISO;
  - `cancelAt` is always null.
- Mapping (spec §4.4):

| Razorpay `event` | `kind` | `status` | extra rule |
|---|---|---|---|
| `subscription.authenticated` | `checkout_completed` | `trialing` | only when `start_at` > `created_at`, otherwise `null` (ignored; `activated` follows) |
| `subscription.activated` | `checkout_completed` | `active` | |
| `subscription.charged` | `invoice_paid` | `active` | |
| `subscription.pending`, `subscription.halted` | `payment_failed` | `past_due` | |
| `subscription.cancelled` | `trial_card_removed` if `paid_count === 0` and `start_at` > `created_at`, else `subscription_deleted` | `canceled` | |
| `subscription.completed`, `subscription.expired` | `subscription_deleted` | `canceled` | |
| anything else | `null` | | |

- [ ] **Step 1: Write the fixtures and the failing tests**

  - Fixtures, in Razorpay's webhook shape (`entity: "event"`, `event`, `created_at`,
    `payload.subscription.entity` with `id: "sub_TEST1"`, `customer_id: "cust_TEST1"`, `plan_id`, `status`,
    `current_start`, `current_end`, `start_at`, `paid_count`,
    `notes: { business_id: "11111111-1111-4111-8111-111111111111", interval: "month" }`). One file each:
    - `authenticated.trial.json` (start_at 5 days after created_at);
    - `authenticated.now.json`;
    - `activated.json`;
    - `charged.json`;
    - `pending.json`;
    - `halted.json`;
    - `cancelled.paid.json`;
    - `cancelled.trial.json` (paid_count 0, start_at in the future);
    - `completed.json`;
    - `updated.json`.
  - Tests:
    - `signature: valid passes; wrong secret, tampered body (one byte changed), missing header and wrong length fail`.
      Build the valid signature in the test with `createHmac("sha256", secret).update(raw).digest("hex")`.
    - One test per row of the mapping table, asserting `kind`, `status`, `subscriptionId`, `businessId`, `interval`,
      and the ISO `currentPeriodEnd` / `trialEnd`.
    - `authenticated without a future start_at is ignored (null)`.
    - `updated is ignored (null)`.
    - `a missing notes.business_id gives businessId null`.
    - `subscriptionSnapshot: status, currentPeriodEnd, trialEnd only while authenticated, cancelAt null, exists true`.

- [ ] **Step 2: Run the tests and check they fail**

  Run: `node --experimental-strip-types --test tests/billing-razorpay.test.mjs`
  Expected: FAIL, because `lib/billing/razorpay-events.ts` cannot be found.

- [ ] **Step 3: Implement `lib/billing/events.ts` and `lib/billing/razorpay-events.ts`; repoint imports**

  Every import of `BillingEvent`, `BillingInterval` or `BillingEventKind` moves to `./events.ts`.

- [ ] **Step 4: Rewrite the webhook route**

  - It needs `RAZORPAY_WEBHOOK_SECRET`; if it is missing, answer 503 with `BILLING_NOT_SET_UP`.
  - Read the raw body with `request.text()`.
  - Verify the `x-razorpay-signature` header. If it fails, answer 400 `{ error: "Invalid Razorpay signature." }` and
    apply nothing.
  - Read the event id from `x-razorpay-event-id`. If it is missing, answer 400.
  - Parse the JSON, normalize it, then `applyBillingEvent`, with today's error and status handling.
  - The handling of `superseded` is added in Task 3; until then it is returned as 200.

- [ ] **Step 5: Run the tests and check they pass**

  Run: `npm test`, `npm run typecheck`
  Expected: pass.

- [ ] **Step 6: Commit**

  `git commit -m "feat(billing): Razorpay webhook events and signature check"`

---

### Task 3: Razorpay provider, routes, site info and Stripe removal

**Files:**
- Create:
  - `lib/site-info.ts`;
  - `lib/billing/razorpay-api.ts` (fetch wrapper);
  - `app/api/v1/billing/update-card/route.ts`;
  - `app/api/v1/billing/cancel/route.ts`;
  - `tests/billing-provider.test.mjs`.
- Modify:
  - `lib/billing/provider.ts`, `lib/billing/billing-check.ts`, `lib/admin/billing-check-run.ts`;
  - `app/api/v1/billing/checkout/route.ts`, `app/api/v1/billing/webhook/route.ts`;
  - `lib/billing/pretend-events.ts` (new action `remove_trial_card`);
  - `tests/billing-check.test.mjs`;
  - `.env.example`, `package.json`, `package-lock.json`.
- Delete: `lib/billing/stripe-events.ts`, `app/api/v1/billing/portal/route.ts`.

**Interfaces:**
- `lib/site-info.ts`:
  - `export const SITE_INFO = { legalName: "[LEGAL BUSINESS NAME]", address: "[REGISTERED ADDRESS]", email: "[SUPPORT EMAIL]", phone: "[PHONE]" }`;
  - `export type SiteInfo = typeof SITE_INFO`;
  - `export function hasPlaceholders(info: SiteInfo = SITE_INFO): boolean`, true when any value matches `/^\[.+\]$/` or is
    empty.
- `lib/billing/provider.ts`:
  - `type BillingProviderKind = "razorpay" | "pretend" | "none"`;
  - `type CheckoutResult = { kind: "razorpay"; subscriptionId: string; keyId: string } | { kind: "redirect"; url: string }`;
  - `type CheckoutInput` drops `customerId`;
  - `BillingProvider = { kind; startCheckout(input: CheckoutInput): Promise<CheckoutResult>; updateCardUrl(subscriptionId: string, origin: string): Promise<string>; cancel(input: { businessId: string; subscriptionId: string; atPeriodEnd: boolean }): Promise<void>; getSubscription(id: string): Promise<ProviderSubscription | null> }`;
  - `razorpayConfigured(env)`;
  - `billingProvider(env = process.env, info: SiteInfo = SITE_INFO)`: Razorpay when all five variables are set and
    `!hasPlaceholders(info)`; pretend when not production and no `RAZORPAY_` variable is set; otherwise none.
  - `subscriptionCreateBody(env, input, now = new Date()): Record<string, unknown>` returns:
    - `plan_id` (monthly or annual plan, by interval);
    - `total_count`: `RAZORPAY_MAX_COUNT[interval]`;
    - `customer_notify: 1`;
    - `notes: { business_id, interval }`;
    - `start_at` (unix seconds), only when `trialEndsAt - now > MIN_START_LEAD_MS`.
  - Constants: `MIN_START_LEAD_MS = 24 * 60 * 60 * 1000` and `RAZORPAY_MAX_COUNT = { month: 120, year: 10 }`.
    Check both against Razorpay's Subscriptions docs at build time. If the docs differ, use the docs' values and
    record a ruling (spec §10).
- `lib/billing/razorpay-api.ts`: `razorpayRequest(env, method: "GET" | "POST", path: string, body?: object): Promise<{ status: number; json: unknown }>`.
  - It sends basic auth `key_id:key_secret` to `https://api.razorpay.com/v1`.
  - A "does not exist" answer becomes `getSubscription → null`: status 404, or status 400 with
    `error.description` matching `/does not exist/i`.
- `billing-check.ts`:
  - `ourStatusFor(razorpayStatus)`:
    - `authenticated` → `trialing`;
    - `active` → `active`;
    - `pending` and `halted` → `past_due`;
    - `cancelled`, `completed` and `expired` → `canceled`;
    - `created`, `paused` and anything else → `null`.
  - `FLAG_FIELDS` drops `"cancel_at"`; `FlagField` and `FIELD_LABELS` keep it so old flags still display.
  - The label for `exists` becomes "Subscription exists in Razorpay".
- Routes, all owner-only through `loadOwnerBilling()` as today:
  - `POST /api/v1/billing/checkout` returns `CheckoutResult`. The 409 copy becomes "This shop already has a
    subscription."
  - `POST /api/v1/billing/update-card` returns `{ url }`. It answers 409 "There is no subscription yet. Choose a plan
    first." when there is no `subscriptionId`.
  - `POST /api/v1/billing/cancel` returns `{ cancelAt: string | null }`:
    - 409 "This subscription already ends on <date>." when `cancel_at` is set;
    - 409 when there is no subscription, or when it is canceled;
    - a trialing shop with a card → `cancel({ atPeriodEnd: false })`, then `record_billing_cancel(business, null, user)`
      for the audit row (spec §4.5: either way), then `{ cancelAt: null }`;
    - otherwise → `cancel({ atPeriodEnd: true })`, then `record_billing_cancel(business, current_period_end, user)`,
      then `{ cancelAt }`.

    `loadOwnerBilling()` gains `cancelAt`, `currentPeriodEnd`, `hasPaymentMethod` and `userId`.
- Pretend provider:
  - `startCheckout` → `{ kind: "redirect", url: "/billing/pretend?interval=…" }`;
  - `updateCardUrl` → `/billing/pretend/portal`;
  - `cancel` with `atPeriodEnd: false` applies `pretendEvent("remove_trial_card", …)` through `applyBillingEvent`;
  - `cancel` with `atPeriodEnd: true` does nothing (the route records `cancel_at`; the pretend "renew" action already
    ends a cancelling subscription).
- Webhook: when `applyBillingEvent` returns `"superseded"`, it calls
  `billingProvider().cancel({ businessId, subscriptionId: event.subscriptionId, atPeriodEnd: false })` and answers
  200 `{ result: "superseded" }`. If the cancel throws, it answers 500 so Razorpay redelivers.

- [ ] **Step 1: Write the failing tests** (`tests/billing-provider.test.mjs`; update `tests/billing-check.test.mjs`)

  - `hasPlaceholders: true for the shipped SITE_INFO; false when every field is filled; true when one field is empty`.
  - `billingProvider: all five set + filled info → razorpay`.
  - `billingProvider: all five set + placeholders → none, also in production`.
  - `billingProvider: four of five → none in development and production`.
  - `billingProvider: none set, development → pretend; production → none`.
  - `subscriptionCreateBody: trial 5 days away → start_at = trial end in unix seconds, notes.business_id and interval set, plan by interval`.
  - `subscriptionCreateBody: trial 2 hours away or null → no start_at`.
  - `ourStatusFor maps each Razorpay status as listed`.
  - `compareSubscription no longer reports cancel_at`. Rewrite the existing Stripe-status cases with Razorpay
    statuses.
  - `webhook cancels a superseded subscription`:
    - drive the route's handler with a stub provider and a stub `applyBillingEvent` that returns `superseded`;
    - assert `cancel` was called once with `atPeriodEnd: false` and the event's subscription id.

    Factor `handleRazorpayWebhook(request, deps)` out of `route.ts` into `lib/billing/webhook-handler.ts` so that it can
    be tested.

- [ ] **Step 2: Run the tests and check they fail**

  Run: `npm test`
  Expected: FAIL, because `lib/site-info.ts` and the Razorpay provider are missing.

- [ ] **Step 3: Implement**

  - Write `site-info.ts`, `razorpay-api.ts`, the provider, the routes and the webhook handler.
  - Update the billing-check copy.
  - Run `npm uninstall stripe`.
  - Delete `stripe-events.ts` and the portal route.
  - In `.env.example`, replace the `STRIPE_*` lines with the five `RAZORPAY_*` names, all empty.

- [ ] **Step 4: Run the tests and check they pass**

  Run: `npm test`, `npm run typecheck`, `npm run lint`
  Expected: pass. `git grep -n -i stripe -- lib app package.json .env.example` prints nothing.

- [ ] **Step 5: Commit**

  `git commit -m "feat(billing): Razorpay provider, update-card and cancel routes; Stripe removed"`

---

### Task 4: Billing tab, banner and pretend pages

**Files:**
- Modify:
  - `components/billing/billing-panel.tsx`, `components/billing/lifecycle-banner.tsx`;
  - `lib/billing/plans.ts` (remove `STARTER_VAT_RATE` and `priceWithVat`);
  - `lib/billing/lifecycle-view.ts`, if it formats the "cancels on" or price text;
  - `app/billing/pretend/page.tsx`, `app/billing/pretend/portal/page.tsx` (remove its Cancel button; keep Update card
    and the developer controls);
  - `next.config.ts`;
  - `tests/plans.test.mjs`, `tests/billing-view.test.mjs`.
- Create: `lib/billing/razorpay-checkout.ts` (browser helper).

**Interfaces:**
- Consumes the Task 3 routes.
- Produces:
  - `loadRazorpayCheckout(): Promise<void>`: injects `https://checkout.razorpay.com/v1/checkout.js` once and resolves
    on load;
  - `openRazorpayCheckout(opts: { keyId: string; subscriptionId: string; onPaid: () => void; onDismiss: () => void }): void`.
    It sets `key`, `subscription_id`, `name: "Shop Ledger"`, `description: "Starter plan"`, `handler: onPaid` and
    `modal.ondismiss: onDismiss`.

- [ ] **Step 1: Write the failing tests**

  - `plans.test.mjs`: `PLANS.starter monthly 9900 and annual 99000`, and `plans module exports no VAT helper`
    (`priceWithVat` is undefined).
  - `billing-view.test.mjs`:
    - `price line reads "Starter · AED 99.00 / month" and "Starter · AED 990 / year (2 months free)" with no "VAT"`;
    - `cancelling shows "Cancels on <date>"`.

    Price-line copy that sits in the component: move it to `lib/billing/lifecycle-view.ts` as
    `priceLine(interval): string`.

- [ ] **Step 2: Run the tests and check they fail**

  Run: `npm test`
  Expected: FAIL on the VAT assertions.

- [ ] **Step 3: Implement**

  - **Billing panel:**
    - **Choose a plan:**
      - POST `/checkout`;
      - on a `razorpay` result, call `loadRazorpayCheckout` and then `openRazorpayCheckout`;
      - on `onPaid`, show the toast "Payment received, updating…" and poll `refreshEntitlements()` every 3 s for up to
        60 s until the status changes;
      - on a `redirect` result, call `location.assign` (pretend).
    - **Update card:** POST `/update-card` and open the URL in a new tab. Pretend opens in the same tab.
    - **Cancel subscription:**
      - shown while active, past_due without `cancelAt`, or trialing with a card;
      - opens the existing in-app confirm dialog, which names the shop and the end date ("Starter stays until
        <date>", or for a trial "Your card is removed; the trial continues until <date>");
      - then POSTs `/cancel` and refreshes.
    - Remove "Manage billing" and the `portal` return handling.
  - **Lifecycle banner:** the owner's **Update card** button calls `/update-card`.
  - **`next.config.ts`:**
    - leave the global CSP as it is: it sets no `script-src` or `frame-src`, so Razorpay's script and frames already
      load;
    - add a `/settings` entry that overrides only `Permissions-Policy`, setting
      `payment=(self "https://api.razorpay.com" "https://checkout.razorpay.com")`;
    - make sure the global entry's source excludes `/settings`, so the override is the one sent.

      Ruling: the spec's "widen the CSP for the Billing tab" reduces to this one header. If it is wrong, Razorpay's
      wallet buttons inside the window fail; card payment does not need `payment`.

- [ ] **Step 4: Run the tests and check they pass**

  Run: `npm test`, `npm run typecheck`, `npm run lint`
  Expected: pass. `git grep -n "VAT (5%)\|priceWithVat" -- app components lib` prints nothing.

  Verify the headers with the dev server running:
  - `curl -sI localhost:<port>/settings` shows the new `Permissions-Policy`;
  - `curl -sI localhost:<port>/overview` shows `payment=()`.

- [ ] **Step 5: Commit**

  `git commit -m "feat(billing): Razorpay checkout window, update card and cancel in the Billing tab; no VAT on the plan"`

---

### Task 5: Admin console copy

**Files:**
- Modify: `components/admin/shop-actions.tsx`, `lib/admin/actions.ts`, `app/admin/shops/[id]/page.tsx`,
  `components/admin/billing-check.tsx`, `components/admin/grant-panel.tsx`, `components/admin/copy-text.tsx`,
  `app/admin/page.tsx`, `tests/admin-actions.test.mjs`.

- [ ] **Step 1: Write the failing test**

  In `admin-actions.test.mjs`, `trial_has_card` copy equals "Card saved with Razorpay; the trial can't be extended
  here."

- [ ] **Step 2: Run the test and check it fails**

  Run: `node --experimental-strip-types --test tests/admin-actions.test.mjs`
  Expected: FAIL, because the old Stripe copy is still there.

- [ ] **Step 3: Replace the Stripe words in the admin UI**

  - The id labels become "Razorpay customer" and "Razorpay subscription".
  - The shop-actions note uses the same sentence as the test.
  - The grant-refusal copy for `billing_subscription_live` becomes "This shop pays through Razorpay. Cancel that
    subscription first."

- [ ] **Step 4: Run the tests and check they pass**

  Run: `npm test`, `npm run typecheck`
  Expected: pass. `git grep -n -i stripe -- app components lib` prints nothing.

- [ ] **Step 5: Commit**

  `git commit -m "feat(admin): Razorpay wording in the admin console"`

---

### Task 6: Public pages

**Files:**
- Create:
  - `app/(public)/layout.tsx` (header with logo, Sign in, Sign up; footer);
  - `app/(public)/terms/page.tsx`, `privacy/page.tsx`, `refunds/page.tsx`, `contact/page.tsx`;
  - `components/public/site-footer.tsx`.
- Modify:
  - `app/page.tsx`: the home page, replacing the redirect;
  - `lib/auth/access-rules.ts`;
  - `app/login/page.tsx`, `app/signup/page.tsx`: add `<SiteFooter />`;
  - `tests/access-rules.test.mjs`;
  - `app/globals.css`: only if the existing tokens can't lay out the pages.

**Interfaces:**
- Consumes `SITE_INFO` from Task 3, and `PLANS`, `TRIAL_DAYS` and `GRACE_DAYS` from `lib/billing/plans.ts`. Pages read
  every number from those constants, never as literals.
- `access-rules.ts`:
  - add `/`, `/terms`, `/privacy`, `/refunds` and `/contact` to `PUBLIC_PATHS`;
  - add `/` to `SIGNED_OUT_ONLY`, so a signed-in user is sent to `/overview`.
- `SiteFooter` links to Home, Terms, Privacy, Refunds and cancellation, and Contact.

- [ ] **Step 1: Write the failing tests** (`access-rules.test.mjs`)

  - `signed out: /, /terms, /privacy, /refunds, /contact → allow`.
  - `signed in: / → overview; /terms → allow`.
  - `signed out: /overview → login (unchanged)`.

- [ ] **Step 2: Run the tests and check they fail**

  Run: `node --experimental-strip-types --test tests/access-rules.test.mjs`
  Expected: FAIL for `/` and `/terms`.

- [ ] **Step 3: Implement the rules and the pages**

  - **Content** per spec §4.10: refund rule 1, cancel at the end of the paid period, records kept read-only, 7 days of
    grace, Razorpay processes payments and the app never sees card numbers, deletion requests go to
    `SITE_INFO.email`.
  - **Prices:**
    - home: "AED 99 / month", "AED 990 / year (2 months free)", "14-day Pro trial, no card needed";
    - no VAT text anywhere.
  - **Style:** existing design tokens, readable on a phone, one `<h1>` per page, each page with its own `metadata`
    title.

- [ ] **Step 4: Run the tests and check they pass**

  Run: `npm test`, `npm run typecheck`, `npm run lint`
  Expected: pass.

- [ ] **Step 5: Commit**

  `git commit -m "feat(site): public home, terms, privacy, refunds and contact pages"`

---

### Task 7: Docs and the end-to-end check

**Files:**
- Modify:
  - `docs/superpowers/notes/2026-10-21-hosted-auth-setup.md`: §0 lists migration `202610310043`;
  - `docs/superpowers/notes/2026-10-25-billing-check-schedule.md`: Razorpay wording.
- Create: `docs/superpowers/notes/2026-10-31-razorpay-setup.md`.

- [ ] **Step 1: Write `2026-10-31-razorpay-setup.md`**

  1. Ask Razorpay to enable international payments and Subscriptions.
  2. Create two plans in AED (99 a month, 990 a year) and copy their plan ids.
  3. Add a webhook to `https://<app>/api/v1/billing/webhook` with every event in spec §4.4 and a secret.
  4. Set the five variables on Vercel (Production) and redeploy.
  5. Fill in `lib/site-info.ts` before going live; billing stays "not set up" until you do.
  6. Do one test-mode run: subscribe with Razorpay's test card, cancel, and check the admin billing check.
  7. The approval checklist: each required item, and the page where it lives.

- [ ] **Step 2: Run the browser check** (local Supabase, pretend provider)

  Restore the worktree's `.claude/launch.json` from the scratchpad copy (`launch.1f-dev.json`) if it is needed, then
  run through:
  1. trial → Choose a plan → pretend pay → card saved;
  2. end trial → active;
  3. Fail next renewal → past_due banner (owner and cashier);
  4. end grace → stop screen at register open;
  5. Update card → active;
  6. Cancel → "Cancels on <date>" → renew → read-only;
  7. a new trial shop with a card → Cancel → still trialing, "Choose a plan" offered;
  8. signed out: `/`, `/terms`, `/privacy`, `/refunds`, `/contact` and the footer on `/login`;
  9. signed in: `/` → `/overview`.

  Expected: each step behaves as described. Fix any failure as part of this task.

- [ ] **Step 3: Run the full suite**

  Run: `npm test`, `npm run test:sql`, `npm run typecheck`, `npm run lint`, `npm run build`
  Expected: all pass.

- [ ] **Step 4: Commit**

  `git commit -m "docs: Razorpay setup and release notes for Stage 1J"`
