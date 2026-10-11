# Shop Ledger SaaS: Paid Plans and Product Improvements

Date: 2026-10-11
Status: Draft for owner review
Supersedes: the single-shop scope and exclusions in `docs/PRD.md` (the PRD remains valid for fiscal rules)

## 1. Intent

Turn Shop Ledger from a single-shop UAE till into a subscription product for GCC retailers.

- **Business model:** self-serve SaaS for small shops, plus custom Enterprise deals.
- **Market:** GCC. The UAE launches first, KSA (with ZATCA e-invoicing) follows.
- **Target shops:** grocery/supermarket and electronics/mobile shops.
- **Pricing:** feature tiers, plus paid add-ons for extra tills and branches. Billed through Stripe.
- **Entry offer:** a 14-day Pro trial with no card required.
- **Delivery strategy:** ship a sellable **Starter launch** first, then grow into the higher tiers. The data model and entitlement system for every tier are built in Stage 1, so adding tiers later is configuration, not a rewrite.

### Success criteria

- Stage 1: 5–10 UAE shops paying for Starter; zero invoice data loss; a normal sale completed in under 30 seconds including cash change.
- A plan change (upgrade, downgrade, add-on) takes effect without a deploy.
- Fiscal records are never blocked, altered or lost because of a billing state.

## 2. Plans

Prices are placeholders (AED/SAR per month). Annual billing gives 2 months free.

| | Starter (79) | Pro (179) | Business (349) | Enterprise (custom) |
|---|---|---|---|---|
| Branches / tills included | 1 / 1 | 1 / 2 | 3 / 6 | Custom |
| Staff logins | Owner + 1 | 5, with roles and PINs | 20 | Unlimited, SSO |
| Products | 1,000 | Unlimited | Unlimited | Unlimited |
| POS, inventory, customers, returns, register, daily report, offline | ✓ | ✓ | ✓ | ✓ |
| VAT invoices, bilingual EN/AR receipts, e-invoicing (ZATCA/UAE) | ✓ | ✓ | ✓ | ✓ |
| Product editing, CSV import/export, barcode labels | ✓ | ✓ | ✓ | ✓ |
| Cash received / change due, hold sale, basic manual discounts, sales search | ✓ | ✓ | ✓ | ✓ |
| Weighed items and scale barcodes | – | ✓ | ✓ | ✓ |
| Serial/IMEI tracking and warranties | – | ✓ | ✓ | ✓ |
| Split payment, promotions and discount rules | – | ✓ | ✓ | ✓ |
| Suppliers and purchase orders | – | ✓ | ✓ | ✓ |
| Categories, cost price and margin | – | ✓ | ✓ | ✓ |
| Date-range, product and staff reports with charts | – | ✓ | ✓ | ✓ |
| WhatsApp/email receipts, low-stock alerts | – | ✓ | ✓ | ✓ |
| Repair job cards | – | – | ✓ | ✓ |
| Customer credit accounts, loyalty points | – | – | ✓ | ✓ |
| Multi-branch stock transfers, branch comparison, consolidated reports | – | – | ✓ | ✓ |
| Accounting export (Zoho, Xero, QuickBooks), API access, full audit log, daily owner email | – | – | ✓ | ✓ |
| Support | Email | Email + chat | Priority | Dedicated, SLA |

- **Add-ons:** an extra till at about 49 per month, an extra branch at about 129 per month.
- **Rule:** legally required capability (tax invoices, e-invoicing, invoice retention and export) is never gated by plan.

## 3. Architecture

### 3.1 Accounts, branches and roles

```
businesses (tenant: subscription, legal name, tax ID, country, currency)
 ├─ business_members (user_id, role, branch access, status)
 └─ branches (name, address, invoice prefix, receipt footer)
     └─ devices (registered till, PIN-locked, one open register)
```

- Replace `businesses.owner_id unique` with `business_members`. The first member is the Owner.
- Replace `owns_business(business_id)` with `has_role(business_id, min_role)` across all row-level security policies and RPCs, in one migration.
- **Roles:**
  - **Owner:** everything, including billing, plan, tax settings and managing staff.
  - **Manager:** products, stock, customers, reports, opening and closing the register, approving refunds.
  - **Cashier:** sell, look up customers, open the register; refunds only with a manager's PIN.
- **Sign-in:** Owners and Managers use email and password. Cashiers use a PIN on an already-registered till.
- Add `branches`. Backfill a "Main branch" for every existing business. Add `branch_id` to `devices`, `register_sessions`, `sales`, `stock_movements`, `cash_movements` and `credit_notes`.
- The catalogue (`products`) stays business-level. Stock on hand is computed per branch from `stock_movements`.
- `sales` and `credit_notes` record `member_id` (the staff member who did it).
- Several legal entities (different tax numbers) are handled as separate accounts.

### 3.2 Entitlements and billing

- **Plan catalogue in code:** `lib/billing/plans.ts`. Each plan holds `{ id, features: FeatureKey[], limits: { branches, tills, members, products }, stripePriceIds: { AED, SAR, monthly, annual } }`.
- **New tables:**
  - `subscriptions`: `business_id`, `stripe_customer_id`, `stripe_subscription_id`, `plan_id`, `status`, `trial_ends_at`, `current_period_end`, `grace_ends_at`, `addon_tills`, `addon_branches`.
  - `entitlement_overrides`: Enterprise or manual grants, with an optional expiry.
  - `stripe_events`: processed event IDs, so duplicate webhooks are ignored.
- **Single resolver:** the Postgres function `business_entitlements(business_id)` returns the resolved features and limits. It is used by:
  - limit checks inside the RPCs that create branches, devices, members and products
  - `GET /api/v1/entitlements` for the UI
  - a signed snapshot that each till caches (valid for 72 hours) so it keeps working offline
- **Stripe:**
  - **Signup:** the trial starts without a card, with reminders on days 10 and 13. Stripe Checkout collects the card.
  - **Plan changes:** the Customer Portal handles upgrades, downgrades, add-ons, invoices and payment methods. Add-ons are extra items, with a quantity, on the same subscription.
  - **Webhook:** `app/api/v1/billing/webhook/route.ts` verifies the Stripe signature, ignores duplicate events, and handles subscription created, updated and deleted, plus invoice paid and payment failed.
  - **VAT on the subscription fee:** calculated by Stripe Tax.
- **Lifecycle:**

  | State | Access |
  |---|---|
  | trialing / active | Everything in the plan |
  | past_due | 7-day grace period: full access, plus banner and emails |
  | grace expired / canceled | Read-only: view, print and export. Applied at the next register open, never mid-shift. |
  | after cancellation | Data kept for 90 days; export always available; nothing auto-deleted |

- **Downgrade over a limit:** the owner picks which tills, branches and members stay active. Data created by higher-tier features stays viewable and read-only.
- **Offline:** sync re-checks entitlements but never rejects an already-issued fiscal document. Exceptions are flagged for review.
- **UI:**
  - `useEntitlement(featureKey)` and `<FeatureGate feature=… >`: locked features show an "Available on Pro" prompt instead of disappearing.
  - An owner-only Billing tab in Settings.
- **Internal admin console** (`/admin`, restricted to a platform-staff allowlist): list tenants, extend trials, set overrides, view subscription status.

### 3.3 Countries, tax and currency

- **Country profile in code:** `lib/fiscal/countries.ts`. Each profile holds currency, minor-unit exponent, timezone, VAT rates, tax-ID validator, invoice titles (EN/AR) and e-invoicing adapter.

  | Country | VAT | Currency (decimals) | E-invoicing |
  |---|---|---|---|
  | UAE | 5% | AED (2) | Upcoming mandate, via an Accredited Service Provider |
  | KSA | 15% | SAR (2) | ZATCA Phase 2 |
  | Bahrain | 10% | BHD (3) | — |
  | Oman | 5% | OMR (3) | Planned |
  | Kuwait | 0% | KWD (3) | — |
  | Qatar | 0% | QAR (2) | — |

- **Country is chosen at setup** and locked after the first invoice.
- **Database changes:**
  - Drop the `timezone = 'Asia/Dubai'` constraint.
  - Validate the TRN format per country in the application layer and in RPCs.
  - Add `businesses.country` and `businesses.currency`.
- **Money:** amounts remain integers in minor units. Existing `*_fils` columns keep their names and are documented as minor units. The domain layer uses `Money { minor, currency }`.
- **Tax category per product:** `products.tax_category` (`standard | zero | exempt`). Each sale line stores the rate it was charged at.
- **E-invoicing:** behind an `EInvoiceAdapter` interface. The KSA ZATCA adapter is built in Stage 3: onboarding, signing, QR code, invoice hash chain, reporting within 24 hours and clearance. It reuses the offline sync queue.

## 4. Improvement audit findings

These come from a 2026-10-11 review of all screens at desktop, tablet and phone widths.

### Critical (Stage 1)

1. **The data source is the browser demo store, even after Supabase sign-in.** Make the server the source of truth, with IndexedDB as the offline cache. Remove the demo store from production builds. Offer a separate, clearly labelled sample shop for trials.
2. **One tap completes a sale** (`pos-workspace.tsx` `pay()`). Add a payment step: amount received, quick buttons for exact amount and notes, change due, then Complete.
3. **Full page reload to the invoice after each sale.** Show the receipt in a panel (Print / Send / New sale on Enter) and stay on the POS.
4. **No warning for a register left open from a previous day.** Prompt the user to close it before selling.
5. **No product editing.** Edit name, price, barcode, tax category and active status. Price changes apply to future sales only.

### POS / checkout

- Two-column POS down to 768px wide. On phones, a fixed cart bar at the bottom (items, total, Pay).
- Quick-key tiles, a quantity number pad (`3 ×` then scan), hold and resume a sale, scanning the same barcode again adds 1 to the line.
- Feedback for scan success and unknown barcodes, with "Add product now" for an unknown barcode.
- Touch targets ≥ 44px. Basic line and invoice discounts.

### Layout and navigation

- Phone bottom nav: 4 primary tabs plus "More". Fix the header wrapping onto 3 lines.
- Move the email and Sign out into a sidebar user menu. Show the branch and till name instead.
- Collapse the large summary cards on list pages into a compact strip.
- Search, filters, date range and pagination on Sales, Customers and Reports.
- Replace "LOCAL CACHE" with plain status text: "Online · synced" / "Offline · N waiting".

### Polish and accessibility

- Toast notifications and proper confirmation dialogs (replace `window.confirm`).
- Skeleton loading states and consistent empty states.
- Onboarding checklist: business details → first product or import → open register → first sale.
- Split Settings into tabs: Business, Branches and tills, Staff, Tax and invoices, Billing, Data.
- Full Arabic UI and RTL support (logical CSS properties, `dir="rtl"`), planned for Stage 3.

## 5. Delivery stages

Each stage gets its own implementation plan. Only Stage 1 is planned in detail next.

### Stage 1: Sellable Starter (UAE)

**Goal:** a shop can sign up, trial, pay for Starter, and run its day with no risk of data loss.

1. **Foundations migration:**
   - `business_members`, `has_role()` and the policy rewrite
   - `branches` plus backfill, and `branch_id` columns
   - `businesses.country` and `currency`, and `products.tax_category`
   - `subscriptions`, `entitlement_overrides`, `stripe_events`, and `business_entitlements()`
2. **Fiscal country layer:**
   - `lib/fiscal/countries.ts`, with only the UAE enabled
   - `Money` with a currency exponent
   - refactor `calculateVatInclusive` to take a rate
   - extend `tests/fiscal.test.mjs`
3. **Server-first data:**
   - replace `lib/demo-store.ts` reads and writes with Supabase queries and RPCs, keeping the IndexedDB outbox for offline
   - the sample shop exists only in trial demo mode
4. **Checkout fixes:** payment step with change due, receipt panel instead of a page reload, a stale-register warning, hold and resume, basic discounts, the same-barcode increment.
5. **Catalogue:** product editing, CSV import and export, barcode label printing.
6. **Navigation and layout:** phone nav with "More", user menu, compact summary strip, sync status text, search and pagination on Sales and Customers.
7. **Billing (Starter only, plus the Pro trial):**
   - Stripe Checkout, Customer Portal and webhook
   - the entitlements API, `useEntitlement` and `FeatureGate`
   - lifecycle states, the read-only mode, and the Billing settings tab
8. **Onboarding:** self-serve signup → country (UAE) → business details → the checklist.
9. **Internal admin console:** minimal (tenants, trial extension, overrides).
10. **Polish:** toasts and dialogs, skeletons, Settings tabs.

During Stage 1 the Pro trial unlocks only what exists (for example a second till). Unbuilt Pro features show a "coming soon" state.

**Exit criteria:**
- the PRD acceptance journeys pass against Supabase
- the Stripe test-mode lifecycle (trial → active → past_due → read-only → reactivate) passes end to end
- no demo store remains in production code paths

### Stage 2: Pro tier

Staff roles and cashier PINs, multiple tills, split payment, promotions, weighed items and scale barcodes, serial/IMEI and warranties, suppliers and purchase orders, categories and margin, advanced reports, WhatsApp/email receipts and alerts. Final priority order is set from pilot-shop feedback.

### Stage 3: KSA

KSA country profile, ZATCA adapter and certification, SAR prices in Stripe, full Arabic/RTL UI.

### Stage 4: Business and Enterprise

Multi-branch transfers and consolidated reports, repair job cards, customer credit and loyalty, accounting export, public API, audit-log viewer, SSO.

## 6. Error handling and testing

- **Webhooks:** signature-verified, duplicates ignored (`stripe_events`), entitlement updates applied in one transaction. A daily reconciliation job compares Stripe and `subscriptions`.
- **Limit checks:** raise typed errors (`plan_limit_reached`, `feature_not_in_plan`). The UI maps them to upgrade prompts.
- **Offline:** an expired entitlement snapshot blocks only new register opens, never an in-progress sale or sync of issued invoices.
- **Tests:**
  - unit tests for plan resolution, country profiles, money and VAT maths
  - SQL tests for `has_role` and limit RPCs with two tenants (cross-tenant access denied)
  - webhook tests with Stripe fixture events
  - browser checks for the PRD acceptance journeys

## 7. Out of scope (all stages for now)

Integrated card terminals, e-commerce, a parent "organisation" spanning several legal entities, a native mobile app.

## 8. Open items for the owner

- Final plan names and prices, and whether to show SAR pricing before the KSA launch.
- Accountant confirmation of VAT treatment for the subscription fee (Stripe Tax registration).
- The choice of UAE e-invoicing ASP partner (needed before the UAE mandate applies to customers).
