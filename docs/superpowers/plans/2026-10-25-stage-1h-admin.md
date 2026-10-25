# Stage 1H Internal Admin Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The platform owner opens `/admin`, finds a shop, sees its plan, billing and tills, extends a trial or gives an extra till for a while (each audited with a note), and sees billing mismatches that a daily check flags against Stripe.

**Architecture:** A pure staff check (`PLATFORM_STAFF_EMAILS` allowlist + confirmed email) gates `/admin` pages and `/api/v1/admin/*` routes, which return 404 to everyone else and do all reads and writes with the service-role client. Writes go through service-role-only SQL functions that change one thing and write an `audit_events` row in the same transaction. The billing check is a pure comparison of our `subscriptions` row with the provider's view, recorded as flags by a service-role function; it never changes `subscriptions`.

**Tech Stack:** Next.js 16 (server components / route handlers), Supabase Postgres (service-role functions, a new flags table), the existing Stripe SDK and billing provider, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-25-stage-1h-admin-design.md`

## Global Constraints

- Staff = signed-in user whose email is in `PLATFORM_STAFF_EMAILS` (comma-separated, trimmed, case-insensitive) **and** whose email is confirmed. Missing or empty env → nobody is staff. Everyone else (including signed-out visitors) gets **404** on `/admin*` and `/api/v1/admin/*`, except the cron call below.
- Daily check route `POST /api/v1/admin/billing-check` also accepts header `x-admin-cron-secret: <ADMIN_CRON_SECRET>` (≥ 32 chars; constant-time compare); wrong or missing secret and not staff → 401 for this route only.
- Admin reads/writes only on the server with `createAdminClient()` (`lib/supabase/admin.ts`) after the staff check; nothing admin-related is imported by client components except plain types and the action UI that calls the admin API.
- Every admin write requires a note (1–500 chars) and writes an `audit_events` row with `actor_id` = staff user id, `action` one of `admin.extend_trial`, `admin.extra_till`, `admin.end_extra_till`, `admin.flag_seen`, `summary` with before/after values and the note.
- Extend trial: only when status is `trialing`; refused when `has_payment_method` (copy: "Change the trial end in Stripe"); new end must be in the future; quick choices "+7 days" / "+14 days" from max(now, current trial end).
- Extra till: `entitlement_overrides` row with `max_tills = plan_catalog.max_tills(plan) + 1`, `expires_at` = chosen future date, `note`; one active extra-till override per shop (a new one ends the active one first); "End now" sets `expires_at = now()`.
- Billing check never updates `subscriptions`. Compared fields: `status`, `current_period_end` (±1 hour), `cancel_at` (±1 hour), `trial_end` (±1 hour), `exists`. One open flag per (business, field); flags close only by "looked at"; a still-wrong field reopens on the next run.
- Status copy in plain words reuses `billingSummary(e, now)` from `lib/billing/lifecycle-view.ts`.
- Local Supabase only; secrets only in `.env.local`; never the main checkout's `.env.local` or `.claude/launch.json`; no new runtime dependencies; read `node_modules/next/dist/docs` before writing routes/pages.
- Tests: `npm test` (relative `.ts` imports), `npm run test:sql` (new sections before the final `rollback;`), `npm run test:rehearsal` last (resets DB).

## Review Focus

1. **A signed-in shop owner (not staff) opens `/admin`, `/admin/shops/<id>` or calls `/api/v1/admin/*`** → 404 everywhere, no data — Task 1 test `non-staff gets 404 for every admin route`.
2. **Staff email in the allowlist but not confirmed** (someone signs up with the owner's address and never confirms) → not staff — Task 1 unit test.
3. **An extra till that expires while the shop has 3 active tills on Pro** → the 1F till choice appears at next register open, no sale lost — Task 2 SQL test `26c` (limit back to 2 after expiry) + Task 6 browser check.
4. **The billing check running twice on an unchanged mismatch** → one open flag, `last_seen` updated, no duplicate — Task 5 SQL test `26e`.
5. **Extending the trial of a shop that is read-only because its trial ran out** → access returns at the next entitlement refresh; the shop's open register rules (1F) still apply — Task 2 SQL test `26b` + Task 6 browser check.

---

### Task 1: Staff access gate

**Files:**
- Create: `lib/admin/staff.ts`, `lib/admin/require-staff.ts`, `app/admin/layout.tsx` (guard + minimal frame), `app/admin/page.tsx` (placeholder "Shops" heading; Task 3 fills it), `app/api/v1/admin/ping/route.ts` (staff-only GET → `{ ok: true }`, used by the route test)
- Modify: `lib/auth/access-rules.ts` (proxy must not redirect `/admin` paths to /login — they answer 404 themselves), `.env.example` (names `PLATFORM_STAFF_EMAILS`, `ADMIN_CRON_SECRET`)
- Test: `tests/admin-staff.test.mjs`

**Interfaces:**
- Produces: `parseStaffEmails(raw: string | undefined): Set<string>`; `isStaff(user: { email?: string | null; email_confirmed_at?: string | null } | null, env?: Record<string, string | undefined>): boolean`; `requireStaff(): Promise<{ ok: true; userId: string; email: string } | { ok: false }>` (server; uses `createServerSupabaseClient().auth.getUser()`); `notFound()` from `next/navigation` in pages, `Response` 404 in routes; `cronSecretMatches(header: string | null, env?): boolean` (false when env secret missing or shorter than 32).
- [ ] **Step 1: Failing tests:** `parseStaffEmails(" A@x.com , b@y.com,,")` → {"a@x.com","b@y.com"}; `isStaff` true for listed + confirmed (any case), false for unconfirmed, unlisted, null user, missing env; `cronSecretMatches` true only for the exact secret, false for missing/short env secret; `routeDecision` lets `/admin` and `/admin/shops/x` through ("allow") for signed-out visitors so the page can 404.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test; npm run typecheck; npm run lint` → PASS. Local check (dev server from this worktree): signed out → `/admin` 404, `/api/v1/admin/ping` 404; signed in as a normal owner → 404 both (Review Focus 1); with `PLATFORM_STAFF_EMAILS` set to a confirmed local staff account → 200.
- [ ] **Step 5:** Commit `feat(admin): platform-staff gate for the admin console`.

### Task 2: Admin write functions and audit (SQL)

**Files:**
- Create: `supabase/migrations/202610250035_admin_console.sql`
- Modify: `supabase/tests/foundation_test.sql` (sections 26a–26c)

**Interfaces:**
- Produces (all `security definer`, `set search_path = public, extensions, pg_temp`, execute granted to `service_role` only; raise `P0001` with the named message on refusal):
  - `admin_extend_trial(p_business_id uuid, p_trial_ends_at timestamptz, p_actor uuid, p_note text) returns void` — refusals: `not_trialing`, `trial_has_card`, `end_not_in_future`, `note_required`.
  - `admin_give_extra_till(p_business_id uuid, p_until timestamptz, p_actor uuid, p_note text) returns uuid` (override id) — ends any active extra-till override first; `max_tills = plan_catalog.max_tills + 1`; refusals `until_not_in_future`, `note_required`.
  - `admin_end_extra_till(p_business_id uuid, p_actor uuid, p_note text) returns void` — refusal `no_extra_till`.
  - Extra-till overrides are identified by note prefix-free column: add `entitlement_overrides.kind text not null default 'manual' check (kind in ('manual','extra_till'))`.
  - Each writes `audit_events` (action names in Global Constraints) in the same transaction.
- [ ] **Step 1: Failing SQL tests:**
  - 26a: `authenticated` cannot execute any admin function (`42501`); `service_role` can.
  - 26b (Review Focus 5): a Pro trial ended 1 day ago (read-only in `entitlements_internal`) → `admin_extend_trial(+7 days)` → access full, `trial_ends_at` updated, one `audit_events` row `admin.extend_trial` with before/after and note; refusals: active subscription → `not_trialing`; trialing with card → `trial_has_card`; past date → `end_not_in_future`; empty note → `note_required`.
  - 26c (Review Focus 3): Pro shop (2 tills) → `admin_give_extra_till(now+3 days)` → `entitlements_internal` limits.tills = 3 and a third active till can be inserted; giving another replaces the first (only one non-expired `extra_till` row); `admin_end_extra_till` → limit back to 2, the third till stays active (the 1F till choice handles it at register open); audit rows for each.
- [ ] **Step 2:** `supabase db reset; npm run test:sql` → FAIL.
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** `supabase db reset; npm run test:sql` → PASS; `npm run test:rehearsal` last.
- [ ] **Step 5:** Commit `feat(admin): audited trial extension and extra-till overrides`.

### Task 3: Shop list and shop page (read)

**Files:**
- Create: `lib/admin/shops.ts` (server queries with the admin client), `lib/admin/shop-view.ts` (pure formatting), `app/admin/page.tsx` (list), `app/admin/shops/[id]/page.tsx`, `components/admin/*` as needed
- Test: `tests/admin-shop-view.test.mjs`

**Interfaces:**
- Produces: `listShops(input: { query: string; needsLook: boolean; page: number }): Promise<{ rows: AdminShopRow[]; total: number }>`; `getShop(id: string): Promise<AdminShop | null>`; `type AdminShopRow = { id, name, ownerEmail, planId, statusText, createdAt, openFlags: number }`; `type AdminShop = AdminShopRow & { trn, phone, country, ownerConfirmed: boolean, subscription: {...all subscriptions columns}, entitlements: Entitlements, tills: { tillNumber, name, branchName, status }[], tillsAllowed: number | null, overrides: { id, kind, maxTills, expiresAt, note, createdAt, active: boolean }[], flags: AdminFlag[], activity: { action, actorEmail, note, createdAt }[] }`.
- `shopStatusText(e: Entitlements, now: Date): string` = `billingSummary(e, now)`; `tillsLine(active: number, allowed: number | null): string` → "2 of 3 allowed" / "2 (no limit)".
- Search: shop name / owner email / TRN `ilike`, or exact id; newest first; pages of 50; "Needs a look only" filter = open flags > 0. Owner email from `auth.users` via the admin client (`auth.admin.getUserById`, or a service-role SQL view — implementer's choice; record it).
- [ ] **Step 1: Failing tests** for `tillsLine` and `shopStatusText` (reuse fixed dates, e.g. trial 6 days left → "Pro trial · 6 days left").
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement queries and pages (server components; 404 via Task 1's `requireStaff` + `notFound()`).
- [ ] **Step 4:** `npm test; npm run typecheck; npm run lint` → PASS. Browser as staff: list, search by owner email, open a shop; every field of spec §4.3 present.
- [ ] **Step 5:** Commit `feat(admin): shop list and shop page`.

### Task 4: Actions on the shop page

**Files:**
- Create: `app/api/v1/admin/shops/[id]/trial/route.ts`, `…/extra-till/route.ts` (POST give, DELETE end), `…/flags/[flagId]/route.ts` (POST looked-at), `components/admin/shop-actions.tsx`
- Test: `tests/admin-actions.test.mjs`

**Interfaces:**
- Consumes: Task 2 SQL functions; Task 1 `requireStaff`; Task 5's `admin_mark_flag_seen` (Task 4 ships the route; if Task 5 is not yet merged, the flag action lands in Task 5 — keep the route but wire its call in Task 5).
- Produces: `parseExtendTrial(body: unknown, now: Date, currentEnd: string | null): { ok: true; until: string; note: string } | { ok: false; error: string }` (accepts `{ days: 7 | 14 }` or `{ until: ISO }` + note); `parseExtraTill(body, now)` likewise; error mapping `adminErrorMessage(code: string): string` for every refusal code in Task 2 (e.g. `trial_has_card` → "Change the trial end in Stripe", `not_trialing` → "Only trials can be extended").
- UI: buttons Extend trial / Give an extra till / End extra till / Mark looked at, each with a note field and `requestConfirm` naming the shop; after success, re-fetch the page data and toast.
- [ ] **Step 1: Failing tests** for the parsers (days 7/14 from max(now, current end); past date refused; missing note refused; note > 500 refused) and `adminErrorMessage`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test; npm run typecheck; npm run lint` → PASS. Browser as staff: extend a read-only trial (+7) → the owner's shop is usable after refresh; give an extra till; end it.
- [ ] **Step 5:** Commit `feat(admin): extend trial and extra-till actions`.

### Task 5: Daily billing check and flags

**Files:**
- Create: migration `202610250036_billing_flags.sql`; `lib/billing/billing-check.ts` (pure compare); `lib/admin/billing-check-run.ts` (server runner); `app/api/v1/admin/billing-check/route.ts`; `docs/superpowers/notes/2026-10-25-billing-check-schedule.md` (owner steps: set `ADMIN_CRON_SECRET` and `PLATFORM_STAFF_EMAILS` on the host; schedule a daily `POST` with the header — Vercel Cron example and Supabase scheduled function example)
- Modify: `lib/billing/provider.ts` (add `getSubscription(id: string): Promise<ProviderSubscription | null>`; pretend → built from our own row; none → throws "Billing is not set up yet."); `supabase/tests/foundation_test.sql` (26d–26e); shop page/list (open-flag badge and count; Run check now button on the shop page)
- Test: `tests/billing-check.test.mjs`

**Interfaces:**
- Produces (SQL): table `admin_billing_flags (id uuid pk, business_id uuid, field text check in ('status','current_period_end','cancel_at','trial_end','exists'), ours text, theirs text, first_seen timestamptz, last_seen timestamptz, seen_at timestamptz null, seen_by uuid null, seen_note text null)` with a partial unique index on `(business_id, field) where seen_at is null`; RLS enabled with no policies (service role only); `admin_record_billing_check(p_business_id uuid, p_mismatches jsonb) returns void` (upsert open flags per field, bump last_seen; a field that is wrong again after being marked seen opens a new flag); `admin_mark_flag_seen(p_flag_id uuid, p_actor uuid, p_note text) returns void` (audit `admin.flag_seen`); `admin_billing_check_shops()` returning business ids with a Stripe subscription id. All service_role only.
- Produces (TS): `type ProviderSubscription = { exists: boolean; status: string | null; currentPeriodEnd: string | null; cancelAt: string | null; trialEnd: string | null }`; `compareSubscription(ours: SubscriptionRow, theirs: ProviderSubscription): Mismatch[]` with `Mismatch = { field, ours: string | null, theirs: string | null }` — status mapped the same way as `normalizeStripeEvent` (`unpaid` → `past_due`, `incomplete*` ignored); times equal within ±1 hour; missing Stripe subscription → one `exists` mismatch. `runBillingCheck(input: { businessId?: string }): Promise<{ checked: number; mismatches: number } | { error: string }>`.
- Route: staff session OR valid cron header; body `{ businessId? }`; provider none → 200 `{ error: "Billing is not set up yet." }` with nothing done.
- [ ] **Step 1: Failing tests:** `compareSubscription` (each field, ±1 hour tolerance, status mapping, missing subscription); SQL 26d: `admin_record_billing_check` opens one flag per field, a second run with the same mismatch updates `last_seen` without a duplicate (Review Focus 4), `admin_mark_flag_seen` closes it with an audit row, a third run still mismatching opens a new flag; 26e: `authenticated` cannot execute these functions or read `admin_billing_flags`; route cron-secret unit test via `cronSecretMatches`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement (the runner never writes `subscriptions` — assert in a test that the runner only calls `admin_record_billing_check`).
- [ ] **Step 4:** `npm test; npm run test:sql; npm run typecheck; npm run lint` → PASS. Browser as staff (pretend provider): inject a mismatch by editing the local subscription row via SQL after the pretend view was taken (or by a test-only provider stub), Run check now → "Needs a look" on the list and the flag on the shop page; mark looked at.
- [ ] **Step 5:** Commit `feat(admin): daily billing check with flags`.

### Task 6: End-to-end smoke and the full suite

**Files:** none unless a defect is found (failing test or browser RED first, `fix:` commit).
- [ ] **Step 1:** `supabase db reset`; local staff account (confirmed) in `PLATFORM_STAFF_EMAILS` in this worktree's `.env.local`; a normal owner with a Pro shop; dev server on 3101 from this worktree.
- [ ] **Step 2: Checks:** normal owner → 404 on `/admin` and an admin API (RF1); unconfirmed staff email → 404 (RF2); staff: search the shop by owner email, open it; extend its expired trial → owner's shop usable after refresh (RF5); give an extra till → owner registers a third till; end it → the till choice card at the owner's next register open (RF3); billing check twice on one mismatch → one flag (RF4); mark looked at; cron call with wrong secret → 401, with the right one → 200.
- [ ] **Step 3:** `npm test`, `npm run test:sql`, `npm run lint`, `npm run typecheck`, `npm run test:rehearsal`; stop the dev server; `npm run build`. Expected: all pass. Record `1H smoke passed`.
