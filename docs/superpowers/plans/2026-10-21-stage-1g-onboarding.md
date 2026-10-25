# Stage 1G Signup, Onboarding and Cashier Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A UAE shop owner signs up, confirms their email, sets up the shop and follows a three-step checklist to their first sale; cashiers can sell with exactly the access selling needs; tills can only be paused by the till choice.

**Architecture:** Supabase Auth email + password with confirmations and token-hash email links (`verifyOtp`) so links work on any device. Cashier access is RLS on the existing tables (a "today or open session" helper) plus widening the four selling sync RPCs from owner to member; one member-only RPC looks up a sale by exact invoice number for refunds. Checklist progress is an owner-only RPC of three flags; the strip reuses the 1F banner slot. A devices trigger refuses direct writes of `paused`.

**Tech Stack:** Next.js 16 (route handlers, `@supabase/ssr`), Supabase Postgres RLS/RPCs, React 19, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-21-stage-1g-onboarding-design.md`

## Global Constraints

- Local Supabase only; never push to or call the hosted project; never use the main checkout's `.env.local` or `.claude/launch.json` (they point at a hosted project). Dev server for browser checks: `npm run dev -- -p 3101` from this worktree.
- Test credentials only in this worktree's git-ignored `.env.local`; test accounts are created already confirmed through the admin API.
- No new runtime dependencies. Read `node_modules/next/dist/docs` before writing routes/pages (AGENTS.md).
- Copy (exact):
  - Signup heading "Start your free trial", line "14 days of Pro. No card needed.", button "Create account", link "Already have an account? Sign in"; login link "New here? Start your free trial".
  - Check-email: heading "Check your email", "We sent a link to <email>. Open it to continue.", button "Send the link again" (disabled 60 s after each send), link "Wrong address? Start again".
  - Unconfirmed sign-in: "Confirm your email first. We sent a link to <email>."
  - Password rule: "Use at least 8 characters." Network: "Could not reach the server. Try again."
  - Forgot password: link "Forgot password?"; reset page heading "Choose a new password".
  - Checklist: "Get ready to sell · N of 3 · Next: <step>"; steps "Add your products" / "Open the register" / "Make your first sale"; buttons "Add products" (→ /inventory), "Open register" (→ /register), "New sale" (→ /sale); finished "You're ready to sell."
  - Cashier till picker: "Ask the shop owner to add a till."
  - Refund by invoice: field label "Refund a sale by invoice number", not found "No sale with that invoice number."
- Duplicate-email sign-up shows the check-email screen (no "already registered" message).
- Cashier "today": Dubai calendar date (`Asia/Dubai`); a sale is visible to a member when `supply_date = today (Dubai)` or its `register_session_id` is an open session.
- Checklist: owners only, never in sample mode; billing banner wins the slot; no Hide.
- `paused` can be set or cleared only inside security-definer functions (`choose_active_till`); inserts must be `active`; `revoked` changes keep working.
- Tests: `npm test` (node --experimental-strip-types; relative `.ts` imports), `npm run test:sql` (sections go before the final `rollback;` in `supabase/tests/foundation_test.sql`), `npm run test:rehearsal` (resets the DB; run last).

## Review Focus

1. **A cashier's offline shift that runs past midnight** syncs its sales after midnight and still sees them (open session rule) — Task 2 SQL test `25b`.
2. **A cashier syncing a sale/register/customer/credit note** is accepted (RPC guards widened), while product/stock sync and business settings stay owner-only — Task 2 SQL test `25c`.
3. **Refund of an old sale by invoice number** works for a cashier, while that sale stays invisible to plain selects — Task 2 SQL test `25d` + Task 4 browser check.
4. **A confirmation link opened on another device** (no PKCE verifier in that browser) still confirms and lands on /setup — Task 1 unit test of the verify route's param handling + Task 6 browser check in a fresh profile.
5. **The cashier snapshot lacks older rows**; the hosted store must not drop local unsynced work or the owner's cache — Task 4 test `cashier snapshot keeps unsynced local sales`.

---

### Task 1: Signup, email confirmation, forgot password

**Files:**
- Modify: `supabase/config.toml` (`[auth] site_url = "http://localhost:3101"`, `additional_redirect_urls = ["http://localhost:3101/**"]`; `[auth.email] enable_confirmations = true`; local mail catcher enabled; `[auth.email.template.confirmation]` and `[auth.email.template.recovery]` pointing at the two template files below)
- Create: `supabase/templates/confirmation.html`, `supabase/templates/recovery.html` (links: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup` and `...&type=recovery&next=/reset-password`)
- Create: `app/signup/page.tsx`, `app/signup/check-email/page.tsx` (or a state of the signup page), `app/auth/confirm/route.ts`, `app/forgot-password/page.tsx`, `app/reset-password/page.tsx`, `lib/auth/signup.ts`
- Modify: `app/login/page.tsx` (links; unconfirmed message + resend), `proxy.ts` if public routes are listed there
- Create: `docs/superpowers/notes/2026-10-21-hosted-auth-setup.md` (owner steps: SMTP, URL configuration, paste the two templates, and the SQL line to add a cashier: `insert into public.business_members (business_id, user_id, role, status) select b.id, u.id, 'cashier', 'active' from public.businesses b, auth.users u where u.email = '<cashier email>' and b.owner_id = (select id from auth.users where email = '<owner email>');` — verify column names against the migrations first)
- Test: `tests/auth-signup.test.mjs`

**Interfaces:**
- Produces: `validateSignup(input: { name: string; email: string; password: string }): string | null` (exact copy for errors); `signupErrorMessage(error: { message?: string; status?: number } | null): string | null` (network → copy; weak password → rule; "already registered"-style errors → null so the UI shows the check-email screen); `confirmParams(url: URL): { tokenHash: string; type: "signup" | "recovery" | "email"; next: string } | null` (rejects missing params; `next` must start with "/" and not "//", default "/setup" for signup and "/reset-password" for recovery).
- `/auth/confirm` calls `supabase.auth.verifyOtp({ token_hash, type })` with the server client, then redirects to `next`; on failure redirects to `/login?confirm=failed` ("This link has expired or was already used. Sign in or ask for a new link.").

- [ ] **Step 1: Failing tests** — `validateSignup` (empty name, bad email, 7-char password → "Use at least 8 characters."); `signupErrorMessage` (fetch failure → network copy; `User already registered` → null); `confirmParams` (valid signup, valid recovery with next, missing token, `next=//evil.com` → default, `next=https://x` → default).
- [ ] **Step 2:** `npm test` → FAIL (module missing).
- [ ] **Step 3:** Implement the lib, pages, route, config and templates.
- [ ] **Step 4:** `npm test; npm run typecheck; npm run lint` → PASS. `supabase stop; supabase start` (config change) then sign up in the browser on 3101, read the email in the local mail catcher, open the link → /setup. Record evidence.
- [ ] **Step 5:** Commit `feat(auth): self-serve signup with email confirmation and forgot password`.

### Task 2: Cashier access on the server; till status writes

**Files:**
- Create: `supabase/migrations/202610210029_cashier_access.sql` (and `…0030_till_status_guard.sql`)
- Modify: `supabase/tests/foundation_test.sql` (sections 25a–25f)

**Interfaces:**
- Produces (SQL):
  - `public.dubai_today() returns date` (stable): `(now() at time zone 'Asia/Dubai')::date`.
  - `public.member_sees_sale(p_business_id uuid, p_supply_date date, p_register_session_id uuid) returns boolean` (stable, security definer): `has_role(p_business_id,'owner') or (has_role(p_business_id,'cashier') and (p_supply_date = dubai_today() or exists (open register session with that id)))`.
  - Select policies for members: `products` and `customers` (`has_role(business_id,'cashier')`); `sales` (`member_sees_sale(business_id, supply_date, register_session_id)`); `sale_items`, `credit_notes`, `credit_note_items` (through their sale: a credit note is visible when its sale is visible or its own register session is open); `register_sessions` (`status = 'open'` or `business_date = dubai_today()`); `cash_movements` (their session visible). Owner policies unchanged. No member policy on `stock_movements`, `audit_events`, `sync_operations`, `subscriptions`.
  - Sync RPC guards widened from `owns_business` to `has_role(p_business_id, 'cashier')` in `apply_customer_sync`, `apply_sale_sync`, `apply_register_sync`, `apply_credit_note_sync` (copy each latest body — customer/register/credit-note from `202610130016`, sale from `202610190024` — change only the guard). Product and stock sync stay owner-only.
  - `public.find_sale_by_invoice(p_business_id uuid, p_invoice text) returns jsonb` (member-only; exact `invoice_number` match within the business; same JSON shape as `get_sale_detail`; null when not found).
  - Till status guard (`…0030`): `choose_active_till` sets `set_config('app.till_choice','on', true)` before its update; a BEFORE INSERT OR UPDATE OF status trigger on `devices` raises `P0001 'till_status_locked'` when (insert with status <> 'active') or (update where old or new status is 'paused' and `current_setting('app.till_choice', true)` is not 'on'). Redefine `choose_active_till` from its latest body (`202610190024`) adding only the set_config.
- [ ] **Step 1: Failing SQL tests:**
  - 25a: cashier reads products and customers of their shop, none of another shop's; cannot insert/update products directly.
  - 25b (Review Focus 1): cashier sees a sale with today's supply date and a sale from yesterday whose session is still open; does not see a closed-session sale from yesterday; sees the open register session and its cash movements, not yesterday's closed one.
  - 25c (Review Focus 2): cashier `apply_sale_sync`, `apply_register_sync`, `apply_customer_sync`, `apply_credit_note_sync` → accepted; cashier product sync → refused; cashier cannot update the business (0 rows).
  - 25d (Review Focus 3): cashier `find_sale_by_invoice` returns an old sale's JSON (items included); a plain `select` of that sale returns 0 rows; a wrong invoice returns null; another business's invoice returns null; a non-member gets `42501`.
  - 25e: owner inserting a device with status 'paused' → `till_status_locked`; owner `update devices set status='paused'` → `till_status_locked`; owner setting a paused till back to 'active' directly → `till_status_locked`; `choose_active_till` still pauses; owner revoke (`status='revoked'` on an active till) still works.
  - 25f: existing sections 24d/24h that write `paused` directly as postgres keep passing (use `set_config('app.till_choice','on',true)` in those fixtures if needed).
- [ ] **Step 2:** `supabase db reset; npm run test:sql` → FAIL.
- [ ] **Step 3:** Write the migrations.
- [ ] **Step 4:** `supabase db reset; npm run test:sql; npm run test:rehearsal` → PASS.
- [ ] **Step 5:** Commit `feat(access): cashiers read and sync what selling needs; tills paused only by the till choice`.

### Task 3: Onboarding flags and the checklist strip

**Files:**
- Create: migration `…0031_onboarding_status.sql`; `lib/onboarding/checklist.ts`; `components/onboarding/checklist-strip.tsx`; Test: `tests/onboarding.test.mjs`
- Modify: `components/app-shell.tsx` (slot: billing banner first, else checklist), `lib/demo-store.ts` (fetch flags with the snapshot refresh; hosted owners only), `app/(dashboard)/setup` redirect target if needed (setup → /overview)

**Interfaces:**
- Produces (SQL): `public.onboarding_status(p_business_id uuid) returns jsonb` `{ hasProduct, hasOpenedRegister, hasSale }` (owner only, `42501` otherwise); SQL test 25g (owner gets flags flipping as data is added; cashier `42501`).
- Produces (TS): `type ChecklistFlags = { hasProduct: boolean; hasOpenedRegister: boolean; hasSale: boolean }`; `checklistView(flags: ChecklistFlags | null, ctx: { role: Role; mode: StoreMode }): null | { done: number; next: { label: string; button: string; href: string } | null }` — null for non-owners, sample mode or null flags; `next` null when all three are done. `ShopContext.onboarding: ChecklistFlags | null`.
- Strip shows "You're ready to sell." once on the visit where the third step flips to done (component-local state), then nothing.

- [ ] **Step 1: Failing tests** for `checklistView` (0/1/2/3 done with exact copy and hrefs; cashier → null; sample → null) and SQL 25g.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test; npm run test:sql; npm run typecheck; npm run lint` → PASS. Browser: a fresh shop shows "0 of 3 · Next: Add your products"; a 1F billing banner hides the strip.
- [ ] **Step 5:** Commit `feat(onboarding): get-ready-to-sell checklist strip`.

### Task 4: Cashier experience in the app

**Files:**
- Modify: `app/api/v1/snapshot/route.ts` (for non-owners: no stock movements; sales/credit notes as RLS returns them — no 60-day owner query assumptions), `lib/store/*` / `lib/demo-store.ts` (merge keeps local unsynced work when rows are absent), `components/app-shell.tsx` + `components/nav/more-sheet.tsx` (cashier links: Overview, Sales, New sale, Inventory, Customers, Register; Settings only for the Data tab), cashier route guard (Reports, Settings tabs other than data → `/overview`), `components/sales-workspace.tsx` (cashier: Today chip only, no server search, "Refund a sale by invoice number" field), `components/inventory-workspace.tsx` (cashier read-only), `components/till-picker.tsx` (owner-only register form)
- Create: `app/api/v1/sales/by-invoice/route.ts` (member-only, calls `find_sale_by_invoice`, returns `{ sale }` or 404 with the not-found copy), `lib/access/cashier.ts`; Test: `tests/cashier-access.test.mjs`

**Interfaces:**
- Produces: `canUsePage(role: Role, pathname: string, tab?: string | null): boolean`; `navLinksFor(role: Role)`; the refund-by-invoice field opens the existing invoice detail/refund view with the fetched sale (view-and-refund, unlike 1E's view-only old sale) — refund allowed because owner decision 8.
- [ ] **Step 1: Failing tests:** `canUsePage` (cashier: /reports false, /settings?tab=data true, /settings?tab=billing false, /sale true; owner all true); `navLinksFor("cashier")` exact list; `cashier snapshot keeps unsynced local sales` (Review Focus 5: merge a cashier snapshot with no old sales into a store holding an unsynced local sale → the local sale stays).
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test; npm run typecheck; npm run lint` → PASS. Browser as the local cashier: till picker shows no register form; products and today's sales visible; /reports redirects; refund an old sale by invoice number end to end (credit note syncs); New sale syncs.
- [ ] **Step 5:** Commit `feat(access): cashier navigation, today-only sales, refund by invoice number`.

### Task 5: End-to-end smoke and the full suite

**Files:** none unless a defect is found (failing test or browser RED first, `fix:` commit).
- [ ] **Step 1:** `supabase db reset` (with the Task 1 config), dev server on 3101 from this worktree.
- [ ] **Step 2: Checks**, recording each:
  1. Sign up (new email) → "Check your email" → resend works (button disabled 60 s) → open the link from the local mail catcher in a **fresh browser profile/tab without the original cookies** (Review Focus 4) → /setup.
  2. Sign in before confirming (second new account) → unconfirmed copy.
  3. Sign up again with an existing email → check-email screen, no error text.
  4. Setup → Overview with "0 of 3"; add a product → "1 of 3"; open register → "2 of 3"; first sale → "You're ready to sell." then gone after navigation.
  5. Forgot password → email → reset → sign in with the new password.
  6. Add a cashier with the SQL line from the notes file; cashier signs in, picks the till, sells, adds a customer, refunds yesterday's sale by invoice number; cannot see Reports or past sales.
  7. Owner: insert-paused-till attack via the REST API as the owner → refused (`till_status_locked`).
- [ ] **Step 3:** `npm test`, `npm run test:sql`, `npm run lint`, `npm run typecheck`, `npm run test:rehearsal`; stop the dev server; `npm run build`. Expected: all pass. Record `1G smoke passed`.
