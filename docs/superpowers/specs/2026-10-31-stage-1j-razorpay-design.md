# Stage 1J — Razorpay billing and public pages (design)

**Status:** draft for owner review · **Date:** 2026-10-31 · **Branch:** `stage-1j-razorpay`
**Replaces:** the Stripe parts of `docs/superpowers/specs/2026-10-19-stage-1f-billing-design.md` (§4.1 VAT, §4.2 Stripe
provider, §4.3 Stripe events, §4.6 portal) and of `docs/superpowers/specs/2026-10-25-stage-1h-admin-design.md` (§4.5
billing check against Stripe). Everything else in those specs still holds.

## 1. Intent

The business behind the app is registered in India and has a Razorpay account awaiting approval. Shops stay in the UAE
and are charged in AED. Stripe goes away completely; Razorpay takes its place with the same experience for the shop
owner: a 14-day Pro trial, then Starter paid automatically every month or year, a grace period after a failed payment,
and read-only access when the subscription ends.

Razorpay approves an account only after reviewing a live website with pricing, terms, privacy, a refund and
cancellation policy, and contact details. The app has none of these, so this stage adds them.

## 2. Owner decisions (from the conversation)

1. **Why:** only the payment company changes; shops stay in the UAE and are charged in AED. The business is registered
   in India (Razorpay pays out in INR).
2. **Stripe is removed completely**: no switch back, no Stripe code, package, settings or test fixtures left.
3. **Price:** a flat **AED 99 a month** or **AED 990 a year**. **No VAT** is added or shown on the subscription fee.
4. **How the owner pays (option 1):** Razorpay's card window opens over the app from the Billing tab; the owner stays in
   the app. Not a redirect to a Razorpay page, not a payment link each month.
5. **Owner flows and state mapping** (§4.3, §4.4) as presented and approved.
6. **Behind-the-scenes design** (§4.5–§4.9) as presented and approved.
7. **Public pages:** a home page with pricing, terms, privacy, refunds and cancellation, contact; business details are
   **placeholders** for now, which the owner fills in later.
8. **Refund rule (option 1):** no refunds once a paid period has started. Cancelling stops the next renewal; the shop
   keeps full use until the end of the paid period.

## 3. What already exists

- `subscriptions` (plan, status trialing/active/past_due/canceled, `trial_ends_at`, `grace_ends_at`,
  `current_period_end`, `cancel_at`, `canceled_at`, `stripe_customer_id`, `stripe_subscription_id`,
  `has_payment_method`, `billing_interval`, `last_event_at`) and `stripe_events` (event id log), from
  `202610110014_billing_entitlements.sql`.
- One service-role RPC applies a normalized billing event (`202610190023_billing_lifecycle.sql`, revised in
  `202610200027`, `202610200028`, `202610250037`): duplicate, stale and unknown-business handling, grace set once per
  failure episode, canceled is final, trial end can arrive from the provider.
- `lib/billing/provider.ts`: provider `stripe | pretend | none` with `startCheckout`, `openPortal`, `getSubscription`.
  The pretend provider (dev only) drives every state through the same lifecycle path.
- `lib/billing/stripe-events.ts` (Stripe → normalized events), `app/api/v1/billing/webhook/route.ts`,
  `app/api/v1/billing/checkout/route.ts`, `app/api/v1/billing/portal/route.ts`.
- Billing tab `components/billing/billing-panel.tsx` (shows net + 5% VAT), `lib/billing/plans.ts`
  (`STARTER_VAT_RATE`, `priceWithVat`), pretend checkout page showing VAT.
- 1H admin console: billing check (`lib/billing/billing-check.ts`, `lib/admin/billing-check-run.ts`, flags table),
  extend trial refused with "Change the trial end in Stripe." when a card is on file.
- `/` redirects to `/overview`; there are no public pages. `next.config.ts` sets a CSP of
  `frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'` and
  `Permissions-Policy: … payment=() …` on every path.

## 4. Goals

### 4.1 Prices

- Starter: **AED 99 / month** (9900 fils) and **AED 990 / year** (99000 fils), the full amount charged; no VAT line
  anywhere in billing (Billing tab, pretend checkout, public pricing).
- Remove `STARTER_VAT_RATE` and `priceWithVat` and every "+ VAT" label on the subscription fee. VAT on **shop sales**
  (the shop's own invoices) is unrelated and unchanged.
- The annual price is shown as "AED 990 / year (2 months free)".

### 4.2 Billing provider: Razorpay, the local pretend, or none

- Kinds become `razorpay | pretend | none`.
- **Razorpay** when all five server variables are set: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
  `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PLAN_STARTER_MONTHLY`, `RAZORPAY_PLAN_STARTER_ANNUAL` (Razorpay plan ids, plans
  created in AED in the Razorpay dashboard).
- **And** the business details (§4.10) contain no placeholder. With Razorpay variables set but a placeholder left, the
  provider is `none` ("Billing is not set up yet") in every environment *(designer call: live payments never run
  beside placeholder legal pages)*.
- A partial Razorpay variable set is `none` in every environment (as with Stripe today). Pretend: only outside
  production and with no Razorpay variable set.
- Razorpay's REST API is called with `fetch` and HTTP basic auth (key id + secret); **no Razorpay npm package** and the
  `stripe` package is removed *(designer call: no new dependency)*. All calls are server-only. The key secret and
  webhook secret never reach the browser.
- Provider operations:
  - `startCheckout(input)` → `{ subscriptionId, keyId }` for Razorpay; the pretend provider keeps its URL to
    `/billing/pretend`.
  - `updateCardUrl(subscriptionId)` → the Razorpay subscription's hosted link (`short_url`); pretend →
    `/billing/pretend/portal`.
  - `cancelAtPeriodEnd(subscriptionId)` → Razorpay cancel with `cancel_at_cycle_end = 1`.
  - `getSubscription(id)` → `ProviderSubscription | null` for the billing check (null when Razorpay answers "not found").

### 4.3 Paying (Billing tab, owners only)

- The owner picks monthly or yearly and presses **Choose a plan**.
- The server creates a Razorpay subscription:
  - `plan_id` from the interval;
  - `notes.business_id` = the shop id (how webhooks find the shop);
  - `total_count` = the largest count Razorpay accepts for that interval, so the subscription has no practical end;
  - **trial still running** (`trial_ends_at` in the future, beyond Razorpay's minimum lead time): `start_at` =
    `trial_ends_at`, so the card is authorised now and first charged when the trial ends;
  - **trial over or too close** (read-only shop, reactivation after cancel): no `start_at`; the first charge is
    immediate.
- The browser loads Razorpay Checkout (`https://checkout.razorpay.com/v1/checkout.js`) on the Billing tab only and
  opens it with the subscription id and key id. The CSP and Permissions-Policy are widened **for the Billing tab
  route only** to what Razorpay Checkout needs (its script, its frames, its API origin; `payment` for Razorpay's
  origins); every other route keeps today's headers.
- When the window reports success, the tab shows "Payment received, updating…" and refreshes entitlements until the
  webhook has updated the shop. **Only the webhook changes the shop's status**; the browser's success callback changes
  nothing on the server.
- Closing the window without paying changes nothing. The created-but-unpaid Razorpay subscription is left to expire on
  Razorpay's side; a later **Choose a plan** creates a new one *(designer call)*.
- During a trial with a card saved, the tab reads "Pro trial · N days left · Starter starts <date>" (as now).

### 4.4 Razorpay state → shop status

| Razorpay webhook | Shop |
|---|---|
| (window opened, not paid; subscription `created`) | no change |
| `subscription.authenticated` (card saved, `start_at` in the future) | trialing, card on file, trial end = `start_at` |
| `subscription.activated`, `subscription.charged` | active, plan **starter**, `current_period_end` = Razorpay `current_end`, grace cleared |
| `subscription.pending` (charge failed, Razorpay retrying) | past_due; `grace_ends_at` = first failure + 7 days, set once per episode |
| `subscription.halted` (retries exhausted) | stays past_due; read-only after `grace_ends_at` |
| `subscription.cancelled` for a subscription never charged (card saved during a trial, trial still running) | back to trialing without a card until `trial_ends_at`; billing ids cleared |
| `subscription.cancelled` (otherwise), `subscription.completed`, `subscription.expired` *(if sent)* | canceled (final; read-only) |
| `subscription.updated`, others | ignored unless they carry a state above |

- `has_payment_method` is true from `authenticated` onwards and while active/past_due.
- The rules already in the lifecycle RPC still hold: duplicate event ids are ignored, a stale event cannot undo a newer
  one, canceled is final, an unknown business is reported and ignored.

### 4.5 Managing the subscription (Billing tab, owners only)

- **Update card**: shown whenever a Razorpay subscription exists; prominent when past_due. Opens the subscription's
  Razorpay hosted page in a new tab. The payment-failed banner's **Update card** button goes there too.
- **Cancel subscription**: shown while active (or trialing with a card). In-app confirmation dialog naming the end
  date. While paid: calls Razorpay cancel at cycle end, records `cancel_at` = `current_period_end`, the tab shows
  "Cancels on <date>", and the shop becomes read-only when Razorpay's `subscription.cancelled` webhook arrives. During
  a trial with a card saved (nothing charged yet): cancels on Razorpay immediately and the shop stays on its trial
  without a card (§4.4), so "Choose a plan" is offered again. Either way an `audit_events` row is written.
- No in-app invoice list; Razorpay emails each receipt *(designer call)*.
- Cashiers never see billing controls or reach these routes (unchanged).
- Routes: `POST /api/v1/billing/checkout` (now returns `{ subscriptionId, keyId }` or a pretend URL),
  `POST /api/v1/billing/update-card` (replaces `/portal`; returns a URL), `POST /api/v1/billing/cancel`. All
  owner-only on the server, as today.

### 4.6 Webhook (`POST /api/v1/billing/webhook`, same address)

- Verifies `X-Razorpay-Signature` = HMAC-SHA256 of the **raw** body with `RAZORPAY_WEBHOOK_SECRET`, compared in
  constant time; refuses unsigned or wrongly signed requests with 400.
- Event id for duplicates: the `x-razorpay-event-id` header.
- Event time for staleness: the payload's `created_at`.
- Shop: `payload.subscription.entity.notes.business_id`, else the stored subscription id.
- Normalizes each event (`lib/billing/razorpay-events.ts`, replacing `stripe-events.ts`) into the same internal events
  the pretend provider produces, then calls the existing lifecycle RPC.

### 4.7 Database

One migration (`2026103100NN_razorpay_billing.sql`, next free number after `202610290042`):

- Renames `subscriptions.stripe_customer_id` → `billing_customer_id`, `stripe_subscription_id` →
  `billing_subscription_id`, table `stripe_events` → `billing_events`.
- Recreates every function that names those columns or the table (the lifecycle RPC, the billing-check shop list from
  `202610250036`, the trial-end path from `202610250037`, admin reads) with the new names; behaviour unchanged except as
  §4.4 requires.
- Existing hosted rows hold nothing important (owner); the rename keeps them anyway.
- No new RLS policies; the tables stay service-role only.

### 4.8 Daily billing check

- Compares, for every shop with a `billing_subscription_id`: status (mapped as §4.4), current period end (±1 hour),
  trial end (`start_at` while authenticated), and whether the subscription still exists in Razorpay.
- **The cancel-date comparison is dropped**: Razorpay does not expose a scheduled cancel date we can rely on, and our
  own Cancel action records it *(designer call)*.
- Flag rules, schedule, `ADMIN_CRON_SECRET` and the 404 answer are unchanged. Copy says "Razorpay" where it said
  "Stripe" (e.g. "Subscription exists in Razorpay").

### 4.9 Admin console

- Shows Razorpay customer and subscription ids (copyable) instead of Stripe's.
- **Extend trial** for a trial with a card saved stays refused, with "Card saved with Razorpay; the trial can't be
  extended here." Changing only our date would leave Razorpay charging on the old date *(designer call)*.

### 4.10 Public pages

- **`/`**: signed-out visitors see a short home page (a till and billing app for shops in the UAE that works
  offline), pricing (AED 99 / month or AED 990 / year (2 months free), 14-day Pro trial, no card needed to start, no
  VAT line), and **Sign up** / **Sign in**. Signed-in users still go straight to `/overview`.
- **`/terms`**: the service, the trial, automatic renewal through Razorpay, cancellation, read-only access after the
  subscription ends, acceptable use, governing details from the business block.
- **`/privacy`**: what is stored (account, shop and sales data), why, where (Supabase), who processes payments
  (Razorpay; the app never sees card numbers), how to ask for deletion.
- **`/refunds`**: refund and cancellation policy — no refunds once a paid period has started; cancelling stops the
  next renewal and the shop keeps full use until the end of the paid period; records stay viewable and exportable
  afterwards; a failed payment gives 7 days of grace before read-only.
- **`/contact`**: legal name, registered address, support email, phone.
- A footer with links to all five on the home, sign-in and sign-up pages.
- Business details live in one file (`lib/site-info.ts`) as `[LEGAL BUSINESS NAME]`, `[REGISTERED ADDRESS]`,
  `[SUPPORT EMAIL]`, `[PHONE]`, with a helper that says whether any placeholder is left (used by §4.2).
- All five pages are public: no sign-in, no shop, reachable by Razorpay's reviewers. Existing design tokens. Wording
  drafted by the builder from how the app behaves; the owner approves it.

### 4.11 Docs

- Hosted setup notes: the Stripe steps become Razorpay steps — enable international payments and Subscriptions, create
  the two AED plans, add the webhook (URL, the events in §4.4, secret), set the five variables on Vercel, fill in
  `lib/site-info.ts` before going live, and a test-mode run.
- A short note listing what Razorpay's approval checks and where each item lives in the app.
- The billing-check schedule note says Razorpay instead of Stripe.

## 5. Non-goals

- Keeping Stripe in any form; supporting two providers.
- VAT or GST on the subscription fee; tax invoices for the subscription.
- In-app invoices or receipts list; in-app refunds.
- Plans other than Starter; add-ons; other currencies.
- Final legal wording (the owner approves or has it reviewed).

## 6. Anti-goals

- A forged or replayed webhook changes a shop.
- The browser's payment callback, rather than the webhook, changes a shop's status.
- The Razorpay key secret or webhook secret reaches the browser.
- Live payments run while the public pages still show placeholders.
- A cashier reaches checkout, update-card or cancel.
- Widening the CSP for any route other than the Billing tab.

## 7. Constraints

- Local Supabase only; never push to or call the hosted project. Secrets only in the git-ignored `.env.local`.
- Next.js 16 (read `node_modules/next/dist/docs` before writing routes or pages).
- No new runtime dependencies; the `stripe` package is removed.
- No real Razorpay calls in automated tests; recorded Razorpay-shaped payloads only.

## 8. Testing

- **Unit:**
  - webhook signature (valid, wrong secret, tampered body, missing header);
  - each Razorpay event → normalized event (fixtures under `tests/fixtures/razorpay/`);
  - checkout parameters (`start_at` during a trial, none after it or when too close);
  - provider selection (all five set, partial set, placeholders left, production vs not);
  - billing-check mapping (each field, tolerance, missing subscription);
  - prices without VAT;
  - the placeholder helper.
- **SQL:**
  - the renamed columns and table;
  - the lifecycle RPC behaviour carried over (duplicate, stale, grace set once, canceled final, trial end from
    the provider);
  - the cancel action's audit row.
- **Route:**
  - a webhook with a bad signature gives 400 and changes nothing;
  - checkout, update-card and cancel are refused for cashiers and signed-out users;
  - the public pages answer signed-out.
- **Browser** (local, pretend provider):
  - trial → Choose a plan → card saved → trial ends → active;
  - Fail next renewal → past_due banner (owner and cashier) → end grace → stop screen;
  - Update card → active;
  - Cancel → "Cancels on <date>" → period ends → read-only;
  - public pages and footer signed out;
  - the Billing tab loads with the widened CSP, and other routes keep the old headers.
- **Owner step:** one Razorpay test-mode run with real test keys once the account allows Subscriptions.

## 9. Designer calls (owner may overrule)

1. Live billing stays off while any business-detail placeholder is left.
2. Razorpay API via `fetch`, no Razorpay package.
3. A created-but-unpaid Razorpay subscription is abandoned; the next attempt creates a new one.
4. No in-app invoice list; Razorpay's emailed receipts.
5. The billing check no longer compares the cancel date.
6. Extend trial stays refused for a trial with a card saved.
7. CSP widened only on the Billing tab route.
8. `total_count` set to Razorpay's maximum for the interval.

## 10. Left to the builder

- Page layout and copy for the public pages within the existing design tokens.
- Exact Razorpay limits (minimum `start_at` lead time, maximum `total_count`) read from Razorpay's docs at build time.
- Fixture contents.
- How the Billing tab polls after payment.
- Minor error copy.
