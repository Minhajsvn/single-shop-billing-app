# Stage 1F — Billing (design)

**Status:** draft for owner review · **Date:** 2026-10-19 · **Branch:** `stage-1f-billing`
**Parent spec:** `docs/superpowers/specs/2026-10-11-saas-plans-and-improvements-design.md` (sections "Billing", "Lifecycle", Stage 1 item 7)
**Sub-plan row:** `docs/superpowers/plans/2026-10-11-stage-1-starter-launch.md` — 1F: Stripe Checkout, Customer Portal, webhook with duplicate-event handling, `useEntitlement` and `<FeatureGate>`, lifecycle banners, read-only mode at register open, Billing tab.

## 1. Intent

A shop can start on a free 14-day Pro trial, pay for Starter by card, and keep trading through a failed payment without ever being cut off mid-shift. When a shop stops paying, it keeps every record — viewable, printable and exportable — but cannot sell until it pays again.

The owner does not have a Stripe account yet. 1F must therefore work end to end without one, and switch to real Stripe the moment test-mode keys appear in `.env.local`.

## 2. What already exists (from 1A/1B)

- `subscriptions` (one row per business: `plan_id`, `status` trialing/active/past_due/canceled, `trial_ends_at`, `current_period_end`, `grace_ends_at`, Stripe ids, add-on counts), `entitlement_overrides`, `stripe_events` (event id log).
- `entitlements_internal()` / `business_entitlements()` compute `access: "full" | "read_only"` from the subscription: full while active, while trialing before `trial_ends_at`, and while past_due before `grace_ends_at`; read-only otherwise.
- `/api/v1/entitlements` returns signed entitlements; the store caches them (`effectiveEntitlements`, expiry).
- `enforce_plan_limit` trigger blocks a new active till over the plan's limit.
- `lib/billing/plans.ts` holds the plan catalogue (Starter currently AED 79 — wrong, see §4.1).
- **Nothing enforces read-only yet**, and there is no Stripe code, no Billing tab and no banner.

## 3. Owner decisions (from the conversation)

1. **Failed payment:** a banner warns; the till keeps working until the 7-day grace period ends.
2. **Banner audience:** everyone sees it; only the owner can fix it. Owner: "Update card" button + days left. Cashier: "Ask the shop owner to update the card within N days. Sales continue as normal." (mockup Part 1)
3. **Trial ends unpaid:** straight to read-only at the next register open — no grace period.
4. **Read-only look (mockup option B):** opening the register shows a full **stop screen** — "Your shop is read-only. The subscription has ended. You can still view, print and export everything." with **Choose a plan** (owner) and **View sales and reports**. The rest of the app stays open for viewing, printing and exporting, under a red read-only banner; selling, refunds and edits are switched off.
5. **Price:** Starter **AED 99 a month** or **AED 990 a year**, **VAT 5% added on top** (AED 103.95 / AED 1,039.50 charged).
6. **Over the till limit after the trial:** when a shop that registered 2 tills during the Pro trial moves to Starter (1 till), the **owner picks which till stays**; the other is **paused** (not deleted; usable again after an upgrade).
7. **No Stripe account yet:** a local pretend checkout drives every state until real keys are added.
8. **Paying during the trial:** the shop keeps Pro until the trial's day 14; the first Starter charge (and the move to Starter, including the till choice) happens when the trial ends. Checkout passes `trial_end` = the current `trial_ends_at`.
9. **Paying shop offline more than 72 hours** (cached entitlements expired): selling continues, with a banner "Connect to the internet to check your subscription". It is **not** treated as read-only.
10. **Cancelling:** access continues to the end of the paid period (Stripe's default `cancel_at_period_end`); the Billing tab shows "Cancels on <date>". Read-only starts when the subscription is deleted at period end.

## 4. Goals

### 4.1 Plans and prices
- Starter: 9900 fils/month, 99000 fils/year, prices exclusive of VAT. Update `plans.ts` (monthly 9900; add annual) and any price held in `plan_catalog`.
- Stage 1 sells **Starter only**. Pro exists only as the trial. Business/Enterprise are not offered.
- VAT on the subscription fee: Stripe Tax when real Stripe is configured (`automatic_tax`, prices `tax_behavior: exclusive`). The pretend checkout shows the same arithmetic (99.00 + 4.95 = 103.95) as a label only.

### 4.2 Billing provider: real Stripe or the local pretend
- One server module (`lib/billing/provider.ts`) with two implementations chosen at runtime:
  - **Stripe** when `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and the two Starter price ids are set.
  - **Local pretend** otherwise — **only** when `NODE_ENV !== "production"`. In production without keys, billing actions return a clear "Billing is not set up yet" error; the app never fakes a payment in production.
- Operations: `startCheckout(business, interval)` → URL; `openPortal(business)` → URL. Owner-only on the server.
- **Pretend checkout page** (dev only): shows plan, interval, price + VAT, and buttons **Pay (success)**, **Pay (card declined)**, **Cancel**. Each button produces the same internal event a Stripe webhook would, through the same lifecycle handler (§4.3), so the lifecycle code is exercised identically.
- **Pretend portal** (dev only): **Update card (succeeds)**, **Cancel subscription**, plus developer controls **Fail next renewal** and **Advance clock: end trial / end grace / renew period**, so every state can be reached in minutes.

### 4.3 Webhook and lifecycle
- `app/api/v1/billing/webhook/route.ts`: verifies the Stripe signature on the raw body, records the event id in `stripe_events` and **ignores duplicates**, and applies the change **in one transaction** with the subscription update (an RPC run with the service role).
- Events handled: `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`.
- Transitions:

  | From | Event | To |
  |---|---|---|
  | trialing (Pro) | checkout completed (subscription created with `trial_end`) | stays trialing on **Pro** until `trial_ends_at`, card on file; the Billing tab reads "Pro trial · N days left · Starter starts <date>" |
  | trialing with card | trial ends / first invoice paid | active, plan **starter** |
  | active | subscription updated with `cancel_at_period_end` | active, `cancel_at` stored; Billing tab shows "Cancels on <date>" |
  | active | payment failed | past_due, `grace_ends_at = now + 7 days` (set once; a second failure in the same episode does not extend it) |
  | past_due | invoice paid | active, `grace_ends_at = null` |
  | any | subscription deleted | canceled |
  | canceled / trial expired | checkout completed | active (reactivation) |

- Out-of-order events: an event older than the last Stripe event applied to that subscription is ignored (store the applied event's `created` time on the row).
- Webhook tests use **recorded Stripe fixture events** signed in the test with a throwaway secret (Stripe's documented signature scheme); no account needed.

### 4.4 Read-only mode at register open
- The client decides at **register open** from the entitlements cached for this business, re-checked against the device clock: read-only when the status is canceled, when trialing without a card and `trialEndsAt` has passed, or when past_due and `graceEndsAt` has passed. Then opening the register shows the **stop screen** instead.
- **Expired cache (offline over 72 hours) is not read-only** (owner decision 9): the last known status and dates decide, and a grey banner reads "Connect to the internet to check your subscription".
- **Server timing rule** *(designer call)*: the server refuses a register open (explicit, or the session a sale/adjustment sync creates implicitly) only when the session's `openedAt` is after the access end **and** the operation arrives at the server after the access end; an `openedAt` earlier than the access end is trusted only if the operation arrives within 72 hours (the entitlement token lifetime) of the access end. A late-syncing real offline shift is accepted; a backdated clock cannot reopen selling indefinitely.
- **Never mid-shift:** a register that is already open stays usable until it is closed, even if access turns read-only during the shift. Sales made in that shift sync normally.
- The **server** enforces the same rule: a register-open operation for a read-only business is refused (`read_only`), but sales, refunds and the close of a register session opened while access was full are **accepted** — so an offline shift that crosses the deadline still syncs.
- In read-only mode with no open register: New sale, Open register, refunds, product/customer edits, imports and till registration are disabled with a one-line reason. Viewing, printing, exporting (CSV, backup download) and searching stay available.
- When the shop pays again, full access returns at the next entitlement refresh (the Billing tab forces one after checkout).

### 4.5 Banners
- One banner slot under the top bar on every page (`<LifecycleBanner>`), at most one banner at a time; priority read-only > payment failed > offline too long > trial ending.
  - **Payment failed (past_due):** yellow. Owner: "Payment failed. Your card was declined. Update it within N days to keep selling." + **Update card** (opens portal). Cashier: "Payment failed. Ask the shop owner to update the card within N days. Sales continue as normal."
  - **Read-only:** red. Owner: "Read-only. Sales are paused. Invoices, reports and exports still work." + **Choose a plan**. Cashier: same text ending "Ask the shop owner to renew."
  - **Offline too long:** grey, everyone: "Connect to the internet to check your subscription." (owner decision 9)
  - **Trial ending:** a quiet grey line from day 10 of the trial, **owners only**: "Pro trial · N days left · Choose a plan". *(designer call)*
- "N days" counts Dubai calendar days; on the last day it reads "today".

### 4.6 Billing tab (Settings → Billing, owners only)
- Shows the plan and status in plain words ("Pro trial · 6 days left", "Starter · monthly · renews 19 Nov 2026", "Payment failed · grace ends 26 Oct", "Read-only since 2 Nov"), the price with VAT, and the next charge date.
- Actions: **Choose a plan** (monthly / annual toggle → checkout) when trialing or read-only; **Manage billing** (portal: card, invoices, cancel) when a billing customer exists.
- Returning from checkout: `/settings?tab=billing&checkout=success` refreshes entitlements and shows a "Payment received" toast; `checkout=cancel` shows nothing alarming.
- Cashiers do not see the tab.
- In local pretend mode the tab shows a "Test billing — no real charges" badge.

### 4.7 Till limit after the trial
- When the shop has more active tills than its plan allows (typically 2 tills on Starter), the owner gets a **"Choose which till stays"** step (in the Billing tab, and as a blocking card at register open on any till): list of tills; pick one; the others become **paused**.
- A paused till cannot open a **new** register session; the till picker shows it as "Paused — upgrade to use". Its past sales stay visible everywhere.
- **Pausing mid-shift** *(designer call)*: a till paused while its register is open finishes that shift; its queued sales, refunds and register close for sessions opened before the pause still sync (the sync device check accepts a paused device for those sessions only).
- The till choice appears when the trial actually ends and the shop becomes Starter (owner decision 8), not at checkout.
- Until the owner chooses, a register that is open stays usable (no mid-shift surprise), but register open on any till shows the choice card (owner) or "Ask the shop owner to choose which till stays" (cashier).
- Device status gains `paused`; the plan-limit trigger counts only `active` tills (it already does).

### 4.8 `useEntitlement` and `<FeatureGate>`
- `useEntitlement()` returns `{ access, planId, status, trialEndsAt, graceEndsAt, hasFeature(key), limits }` from the cached entitlements.
- `<FeatureGate feature="…">` renders children when allowed, otherwise a small panel. In Stage 1, Pro features that are not built show **"Coming soon"** (parent spec, Stage 1).
- `useCanWrite()` (false in read-only with no open register) drives the disabled write actions in §4.4.

## 5. Non-goals
- Selling Pro, Business or Enterprise; buying add-on tills/branches; SAR/KSA prices.
- Emails (trial reminders on days 10 and 13, dunning emails). 1F uses in-app banners only; Stripe's own failed-payment emails cover dunning once real Stripe is on. *(designer call)*
- The daily Stripe ↔ `subscriptions` reconciliation job — deferred to 1H with the admin console. *(designer call)*
- Member limits (staff management does not exist yet).
- Signup (1G) and the admin console with trial extension (1H).

## 6. Anti-goals
- A sale is ever lost or refused mid-shift because of billing.
- The pretend checkout can run in production, or anything claims a real payment that did not happen.
- A cashier can reach checkout or the portal.
- A replayed or out-of-order webhook moves a subscription backwards (e.g. active → past_due after it was paid).

## 7. Constraints
- Local Supabase only for development and tests; never push migrations to the hosted project.
- Secrets only in the git-ignored `.env.local`; no keys in code, tests or docs.
- New dependency: the official `stripe` npm package (server only). No other new runtime dependencies.
- Next.js 16: read `node_modules/next/dist/docs` before writing routes; the webhook route needs the raw body.
- Offline: banners and the stop screen work from the signed, cached entitlements.

## 8. Testing
- Unit: the lifecycle transition function (table in §4.3, including duplicates and out-of-order), banner choice and day counting, the register-open decision (an open shift stays usable), till-limit detection.
- Webhook: fixture events, valid/invalid signature, duplicate id ignored, one transaction.
- SQL: register open refused when read-only; sales for a session opened under full access accepted after the deadline; a paused till cannot open a register; the limit trigger ignores paused tills.
- Browser smoke with the pretend provider: trial → Pay → active → Fail next renewal → past_due banner (owner and cashier) → Advance clock: end grace → stop screen at next register open (open shift unaffected) → Update card → active; trial with 2 tills → pay Starter → choose the till → the other is paused.

## 9. Designer calls (owner may overrule)
1. Trial-ending line from day 10, owners only; no emails in 1F.
2. The pretend provider is development-only; production without keys shows "Billing is not set up yet".
3. The reconciliation job moves to 1H.
4. Grace is set once per failure episode; repeated failures don't extend it.
5. The annual price is shown as "AED 990 / year (2 months free)".
6. Pausing a till mid-shift lets that shift finish and sync (§4.7).
7. The server timing rule for register open (§4.4).

## 10. Left to the builder
File layout inside `lib/billing/` and `components/billing/`, banner styling within the existing design tokens, the exact copy of disabled-action reasons, and how the pretend clock is stored.
