# Stage 1I Admin Grants, Shop Users and Console Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Platform staff grant a shop a plan by hand (Stripe cannot overwrite it), manage the shop's users from the admin console (list, add/invite, cashier ↔ manager, disable/enable, password-reset email), and the console moves to the app's visual system.

**Architecture:** Grants live in a new `plan_grants` table that `entitlements_internal()` reads first: a grant in force sets the plan and gives full access, and `apply_billing_event` never touches it. Member changes go through new service-role-only `admin_*` SQL functions that write `audit_events` in the same transaction, following the 1H action pattern; the routes do the Supabase Auth calls (lookup, invite, reset email) around them. The restyle swaps the admin pages' Tailwind utility markup for the shared CSS classes in `app/globals.css`.

**Tech Stack:** Next.js 16 (server components, route handlers), Supabase Postgres + Auth admin API (service-role client), Node test runner, `supabase/tests/foundation_test.sql`.

**Spec:** `docs/superpowers/specs/2026-10-29-stage-1i-admin-grants-and-members-design.md`

## Global Constraints

- Staff check unchanged: `requireStaff()` (`lib/admin/require-staff.ts`) gates every page and route; non-staff get 404 (`adminNotFound()`); every unimplemented method of a new route is exported as `adminNotFound`.
- New SQL functions: `security definer`, `set search_path = public, extensions, pg_temp`, execute revoked from `public, anon, authenticated` and granted to `service_role` only; refusals raise `P0001` with the code as message; each writes exactly one `audit_events` row (`actor_id = p_actor`, `summary = {before, after, note}`) in the same transaction; notes go through `admin_clean_note()` (1–500 chars).
- Audit actions: `admin.grant_plan`, `admin.revoke_grant`, `admin.add_member`, `admin.set_member_role`, `admin.set_member_status`, `admin.send_password_reset`.
- A grant in force = `revoked_at is null and starts_at <= at_time and (ends_at is null or ends_at > at_time)`; at most one per shop (partial unique index on `business_id where revoked_at is null`; a new grant revokes the open one in the same function).
- Grant refused (`stripe_subscription_live`) when `subscriptions.stripe_subscription_id is not null and status <> 'canceled'`. Checkout refused (409, "This shop's plan is provided by Shop Ledger.") while a grant is in force.
- Roles staff may set: `cashier`, `manager` only. The owner's member row (`business_members.user_id = businesses.owner_id`) is refused for role and status changes (`owner_protected`).
- Adding a member is refused when: the shop is at its member limit (`plan_limit_reached`, raised by the existing trigger), the account is already a member here (`already_member`), or the account has an active membership in another shop (`member_of_other_shop`).
- Emails are trimmed and lower-cased before any lookup; staff never see, set or receive passwords.
- Plain-words copy for the owner during a grant: `"<Plan> plan · provided by Shop Ledger until <d MMM yyyy>"`, or `"… provided by Shop Ledger"` when open-ended; no lifecycle banner while a grant is in force.
- Migrations are forward-only and numbered after `202610250039`; new SQL tests go in `foundation_test.sql` before the final `rollback;` as sections `27a`–`27k`.
- No new runtime dependencies. Read `node_modules/next/dist/docs` before writing new routes or pages.
- Restyle uses existing classes (`.panel`, `.panel-header`, `.panel-body`, `.button`, `.input`, `.select`, `.textarea`, `.badge`, `.modal*`, `.metric*`, `.table-wrap`, `.stack-table`, `.page-heading`, `.eyebrow`, `.page-title`); no admin page keeps Tailwind colour utilities; dark and light, 360px and up, no horizontal page scroll.

## Review Focus

1. **A Stripe event arrives for a shop that has a grant** (a late `invoice_paid` or `subscription_deleted` from an old subscription) → the grant still decides plan and access — Task 1 SQL test `27c`.
2. **A grant ends (or is revoked) while the shop is open** → the shop falls back to its subscription (e.g. read-only after an old trial), with no data changed and the 1F till choice if it now has too many tills — Task 1 SQL test `27b` + Task 7 browser check.
3. **Staff add an email that already has an account but never confirmed it** → linked as a member (no second account, no invite); they can sign in once they confirm — Task 2 SQL test `27g` + Task 5 route step.
4. **The invite email cannot be sent** (SMTP down, rate limit) → nothing is inserted, the panel shows "The invite email could not be sent. Try again later." — Task 5 test `invite failure leaves no member`.
5. **Re-enabling a disabled cashier on a full shop** → refused with the member-limit message, the member stays disabled — Task 2 SQL test `27i`.

---

### Task 1: Granted plans (SQL)

**Files:**
- Create: `supabase/migrations/202610290040_plan_grants.sql`
- Modify: `supabase/tests/foundation_test.sql` (sections `27a`–`27e`)

**Interfaces:**
- Produces:
  - Table `public.plan_grants(id uuid pk default gen_random_uuid(), business_id uuid not null references businesses on delete cascade, plan_id text not null references plan_catalog, starts_at timestamptz not null default now(), ends_at timestamptz null, granted_by uuid not null references auth.users, note text not null, revoked_at timestamptz null, revoked_by uuid null references auth.users, revoke_note text null, created_at timestamptz not null default now())`; RLS on, no policies (service role only); `create unique index plan_grants_one_open on plan_grants(business_id) where revoked_at is null`.
  - `admin_grant_plan(p_business_id uuid, p_plan_id text, p_ends_at timestamptz, p_actor uuid, p_note text) returns uuid` — refusals `shop_not_found`, `plan_not_found`, `until_not_in_future` (when `p_ends_at` not null and ≤ now()), `stripe_subscription_live`, `note_required`; revokes the open grant first (its `revoke_note` = the new note).
  - `admin_revoke_grant(p_business_id uuid, p_actor uuid, p_note text) returns void` — refusal `no_grant`.
  - `entitlements_internal(target_business_id uuid, at_time timestamptz default now())` (replace, keeping every existing key) adds keys `grantPlanId` (text|null) and `grantEndsAt` (iso|null). When a grant is in force: `planId` = grant plan, `access` = `'full'`, `accessEndsAt` = grant `ends_at`, features/limits come from the grant plan (overrides and extra till still applied on top, as today); `status` stays the subscription's.
- [ ] **Step 1: Failing SQL tests** `27a` service role only (a signed-in owner gets 42501 on both functions; anon/authenticated cannot select `plan_grants`); `27b` a shop with an expired trial gets `access='full'`, `planId='business'`, Business limits after `admin_grant_plan(...,'business', now()+30d,...)`; at `at_time = ends_at + 1 minute` it is back to `read_only` and `grantPlanId` null; revoke has the same effect immediately; `27c` with a grant in force, `apply_billing_event` `subscription_deleted` for that shop leaves `planId='business'`, `access='full'`; `27d` grant refused `stripe_subscription_live` for a shop with `stripe_subscription_id` set and status `active`, allowed once status is `canceled`; `27e` a second grant revokes the first (one open row), and each call writes exactly one audit row (`admin.grant_plan` / `admin.revoke_grant`) with before/after plan and end.
- [ ] **Step 2:** `npm run test:sql` → FAIL (functions missing).
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** `npm run test:sql` → PASS; `npm run test:rehearsal` → PASS.
- [ ] **Step 5:** Commit `feat(admin): granted plans that Stripe cannot overwrite (SQL)`.

### Task 2: Member admin functions (SQL)

**Files:**
- Create: `supabase/migrations/202610290041_admin_members.sql`
- Modify: `supabase/tests/foundation_test.sql` (sections `27f`–`27k`)

**Interfaces:**
- Produces (refusal codes in brackets):
  - `admin_member_lookup(p_business_id uuid, p_email text) returns jsonb` → `{"userId": uuid|null}` for the lower-cased email in `auth.users`; [`shop_not_found`, `already_member`, `member_of_other_shop`, `plan_limit_reached` (pre-check: active members ≥ limit)]. No write, no audit.
  - `admin_add_member(p_business_id uuid, p_user_id uuid, p_role public.member_role, p_actor uuid, p_note text) returns uuid` [`role_not_allowed` for owner, `already_member`, `member_of_other_shop`, `note_required`; `plan_limit_reached` comes from the existing trigger].
  - `admin_set_member_role(p_member_id uuid, p_role public.member_role, p_actor uuid, p_note text) returns void` [`member_not_found`, `owner_protected`, `role_not_allowed`, `note_required`].
  - `admin_set_member_status(p_member_id uuid, p_status public.member_status, p_actor uuid, p_note text) returns void` [`member_not_found`, `owner_protected`, `note_required`; `plan_limit_reached` from the trigger on re-enable].
  - `admin_log_password_reset(p_member_id uuid, p_actor uuid, p_note text) returns void` [`member_not_found`, `note_required`] — audit only.
- [ ] **Step 1: Failing SQL tests** `27f` service role only for all five; `27g` lookup returns the id of an existing **unconfirmed** account and null for an unknown email, refuses an existing member (`already_member`) and an owner of another shop (`member_of_other_shop`); `27h` add a cashier → active member + one `admin.add_member` audit row; adding with role `owner` → `role_not_allowed`; `27i` on a Starter shop (2 members) a third add → `plan_limit_reached`; disabling one then re-enabling another while full → `plan_limit_reached` and the row stays disabled; `27j` role cashier → manager and back writes one audit row each; owner row → `owner_protected` for role and status; `27k` `admin_log_password_reset` writes one `admin.send_password_reset` row and changes nothing else.
- [ ] **Step 2:** `npm run test:sql` → FAIL.
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** `npm run test:sql` → PASS; `npm run test:rehearsal` → PASS.
- [ ] **Step 5:** Commit `feat(admin): member management functions (SQL)`.

### Task 3: Owner side of a grant (entitlements, copy, checkout)

**Files:**
- Modify: `lib/billing/entitlements.ts` (schema + `READ_ONLY_ENTITLEMENTS`), `lib/billing/lifecycle-view.ts`, `lib/billing/owner-session.ts`, `app/api/v1/billing/checkout/route.ts`, `components/billing/billing-panel.tsx`
- Test: `tests/billing-view.test.mjs`, `tests/entitlements.test.mjs`

**Interfaces:**
- Consumes: `grantPlanId`, `grantEndsAt` from Task 1.
- Produces: `Entitlements.grantPlanId: PlanId | null` and `grantEndsAt: string | null` (both `.default(null)` so old caches parse); `isGranted(e: Entitlements, now: Date): boolean` (grant plan set and end null or after now); `billingSummary` returns the Global Constraints grant copy when granted; `bannerFor` returns null when granted; `OwnerBilling.granted: boolean` (from `business_entitlements`).
- [ ] **Step 1: Failing tests:** an old cached entitlement without the grant keys parses with both null; `billingSummary` for `{planId:'pro', grantPlanId:'pro', grantEndsAt:'2026-11-30T19:59:59.999Z'}` → `"Pro plan · provided by Shop Ledger until 30 Nov 2026"`, and with `grantEndsAt:null` → `"Pro plan · provided by Shop Ledger"`; `bannerFor` is null for a granted shop whose subscription is `past_due`; `isGranted` false once `grantEndsAt` has passed.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement; billing panel hides plan/interval choice, checkout and portal buttons when granted and shows the summary line; checkout route returns 409 with the Global Constraints copy when `owner.granted`.
- [ ] **Step 4:** `npm test; npm run typecheck; npm run lint` → PASS.
- [ ] **Step 5:** Commit `feat(billing): owners see a granted plan; checkout refused during a grant`.

### Task 4: Admin action parsers and copy

**Files:**
- Modify: `lib/admin/actions.ts`
- Test: `tests/admin-actions.test.mjs`

**Interfaces:**
- Produces: `GRANTABLE_PLANS: readonly PlanId[]` = `["starter","pro","business","enterprise"]`; `parseGrantPlan(body, now): {ok:true; planId: PlanId; until: string | null; note: string} | Fail` (`until` absent or `"open"` → null; otherwise `parseUntil` future date); `parseRevokeGrant(body): {ok:true; note} | Fail`; `parseAddMember(body): {ok:true; email: string; role: "cashier"|"manager"; note} | Fail` (trimmed, lower-cased, must contain one `@` and a dot after it); `parseMemberChange(body): {ok:true; change: {role: "cashier"|"manager"} | {status: "active"|"disabled"}; note} | Fail` (exactly one of role/status); `parsePasswordReset(body): {ok:true; note} | Fail`. `MESSAGES` gains: `plan_not_found` "Choose a plan.", `no_grant` "This shop has no granted plan.", `stripe_subscription_live` "This shop pays through Stripe. Cancel that subscription first.", `role_not_allowed` "Choose cashier or manager.", `already_member` "This person is already a member of this shop.", `member_of_other_shop` "This account belongs to another shop.", `plan_limit_reached` "This shop's plan has no free member places.", `member_not_found` "This member no longer exists.", `owner_protected` "The shop owner cannot be changed here.", `email_invalid` "Enter a valid email address.", `invite_failed` "The invite email could not be sent. Try again later.", `reset_failed` "The reset email could not be sent. Try again later.".
- [ ] **Step 1: Failing tests:** each parser accepts the happy body and rejects: missing note, note > 500, unknown plan `"gold"`, past date, `" Bob@Shop.AE "` normalises to `bob@shop.ae`, `"bob@"` → `email_invalid`, role `"owner"` → `role_not_allowed`, both role and status → fail; `refusalMessage({code:'P0001', message:'member_of_other_shop'})` → its copy.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test; npm run typecheck` → PASS.
- [ ] **Step 5:** Commit `feat(admin): parsers and copy for grants and members`.

### Task 5: Admin routes and the invite link

**Files:**
- Create: `app/api/v1/admin/shops/[id]/grant/route.ts` (POST grant, DELETE revoke), `app/api/v1/admin/shops/[id]/members/route.ts` (POST add), `app/api/v1/admin/shops/[id]/members/[memberId]/route.ts` (PATCH role/status), `app/api/v1/admin/shops/[id]/members/[memberId]/password-reset/route.ts` (POST), `lib/admin/members.ts` (server: `addMember`, `sendPasswordReset`), `supabase/templates/invite.html`
- Modify: `lib/auth/signup.ts` (`ConfirmType` adds `"invite"`; `DEFAULT_NEXT.invite = "/reset-password"` so the invited person sets a password), `tests/auth-signup.test.mjs`, `tests/admin-staff.test.mjs`
- Test: `tests/admin-members.test.mjs`

**Interfaces:**
- Consumes: Task 2 functions, Task 4 parsers, `isShopId`, `readBody`, `refused`, `rpcFailure`, `createAdminClient()`.
- Produces: `addMember(admin, input: {businessId; email; role; actor; note}, deps?: {invite?(email): Promise<{userId: string} | {error: string}>}): Promise<{ok: true; memberId: string; invited: boolean} | {ok: false; code: string}>` — order: `admin_member_lookup` → if no user, `auth.admin.inviteUserByEmail(email, { redirectTo: <site>/auth/confirm?next=/reset-password })` → `admin_add_member`; an invite error returns `invite_failed` before any insert. `sendPasswordReset(admin, {memberId; actor; note})` reads the member's email, sends the recovery email (`auth.resetPasswordForEmail`), then `admin_log_password_reset`; send error → `reset_failed`, no audit row.
- [ ] **Step 1: Failing tests:** `confirmParams` accepts `type=invite` with default next `/reset-password`; `addMember` with a fake admin whose lookup returns no user and an invite that errors → `{ok:false, code:'invite_failed'}` and `admin_add_member` never called (**Review Focus 4**); lookup returning an existing id → no invite, add called with that id (**Review Focus 3**); the new routes answer 404 for non-staff on every method (extend the existing table in `admin-staff.test.mjs`).
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement routes on the 1H pattern; invite template copies `confirmation.html`'s structure with "You're invited to <shop> on Shop Ledger" and a `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite` link.
- [ ] **Step 4:** `npm test; npm run typecheck; npm run lint` → PASS. Local check with the dev server: add an unknown email → invite email appears in Inbucket; following it lands on `/reset-password`, then the app opens that shop as cashier.
- [ ] **Step 5:** Commit `feat(admin): grant, member and password-reset routes; invite link`.

### Task 6: Admin reads (shop page data and list counts)

**Files:**
- Modify: `lib/admin/shops.ts`, `lib/admin/shop-view.ts`
- Test: `tests/admin-shop-view.test.mjs`

**Interfaces:**
- Produces: `AdminShop.grant: {planId: PlanId; endsAt: string | null; grantedByEmail: string; note: string; createdAt: string; endingSoon: boolean} | null`; `AdminShop.members: {id: string; userId: string; email: string; role: "owner"|"manager"|"cashier"; status: "active"|"disabled"; createdAt: string; lastSignInAt: string | null; isOwner: boolean}[]` (owner first, then by `createdAt`); `AdminShop.membersAllowed: number | null`; `ShopList` gains `counts: {shops: number; needsLook: number; trial: number; granted: number; paying: number}` from the same queries (no per-shop calls); `grantEndingSoon(endsAt: string | null, now: Date): boolean` (within 7 days) in `shop-view.ts`.
- [ ] **Step 1: Failing tests:** `grantEndingSoon` true at 6 days 23 h, false at 7 days 1 h and for null; a pure `sortMembers` keeps the owner first then oldest first.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement (grants and members read with the service-role client; emails and last sign-in via `auth.admin.getUserById`, as owners are today).
- [ ] **Step 4:** `npm test; npm run typecheck` → PASS.
- [ ] **Step 5:** Commit `feat(admin): shop page reads grant and members; list counts`.

### Task 7: Admin console restyle and new panels

**Files:**
- Modify: `app/admin/layout.tsx`, `app/admin/page.tsx`, `app/admin/shops/[id]/page.tsx`, `components/admin/shop-actions.tsx`, `components/admin/billing-check.tsx`, `components/admin/copy-text.tsx`, `components/admin/needs-look-badge.tsx`, `app/globals.css` (an `/* Admin console */` block only)
- Create: `components/admin/grant-panel.tsx`, `components/admin/members-panel.tsx`

**Interfaces:**
- Consumes: Task 4 parsers/copy, Task 5 routes, Task 6 data.
- Produces: `GrantPanel({ shopId, grant, paysThroughStripe })`, `MembersPanel({ shopId, members, membersAllowed })` (client components using the same `send()` + `requestConfirm` + required note pattern as `shop-actions.tsx`).
- [ ] **Step 1:** Layout: glass top bar (`Shop Ledger · Admin`, staff email, link "Open shop app" → `/overview`), no sidebar; list: page heading, metric band from `counts`, sticky search/filter bar, table with `stack-table` + `data-label` cells and soft-dot status pills; shop page: heading with name + pills, two columns ≥1024px (details left; Actions, Grant, Members right), panels for every 1H section.
- [ ] **Step 2:** Grant panel: plan select (`GRANTABLE_PLANS`), "Until" date or "Until revoked" choice, note, Grant / Revoke; disabled with the `stripe_subscription_live` copy when the shop pays through Stripe; "Ends in N days" pill when `endingSoon`.
- [ ] **Step 3:** Members panel: table/cards with email, role pill, status pill, joined, last sign-in; "Add user" dialog (email, role, note); per row: role toggle, Disable/Enable, Send reset email — owner row shows "Owner" with no actions; "N of M places used".
- [ ] **Step 4:** `npm run typecheck; npm run lint; npm test` → PASS. Browser (dev server, staff account): list and shop page in dark and light at 360, 768, 1280, 1920 — no horizontal page scroll; grant a plan to a trial shop → owner's Settings → Billing shows the grant copy and no checkout; revoke → back; add, demote/promote, disable/enable and reset on a test member; Review Focus 2 by granting Starter to a shop with 3 tills.
- [ ] **Step 5:** Commit `feat(admin): restyled console with grant and members panels`.

### Task 8: Release notes and full suite

**Files:**
- Modify: `docs/superpowers/notes/2026-10-21-hosted-auth-setup.md` (step 0 lists `202610290040_plan_grants.sql`, `202610290041_admin_members.sql`; new step: paste `supabase/templates/invite.html` into **Invite user** with subject `You're invited to Shop Ledger`; cashier section points to the admin console instead of SQL), `docs/superpowers/plans/2026-10-29-stage-1i-ledger.md` (create: task log)
- [ ] **Step 1:** Update the notes.
- [ ] **Step 2:** `npm test; npm run typecheck; npm run lint; npm run build; npm run test:sql; npm run test:rehearsal` → all PASS.
- [ ] **Step 3:** Commit `docs: Stage 1I release notes and ledger`.
