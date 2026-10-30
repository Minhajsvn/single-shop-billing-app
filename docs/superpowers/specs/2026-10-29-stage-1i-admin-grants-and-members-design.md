# Stage 1I — Admin: granted plans and shop users (design)

**Status:** approved by owner (2026-10-29) · **Date:** 2026-10-29 · **Branch:** `stage-1i-admin-grants-members`
**Parent spec:** `docs/superpowers/specs/2026-10-25-stage-1h-admin-design.md` (admin console, staff allowlist, action pattern, audit).

## 1. Intent

The platform owner can give a shop a paid plan by hand (a pilot shop, a partner, a shop paying by bank transfer) and can look after a shop's people (see who uses it, add a cashier, change or disable someone, send a password reset) from the admin console — without the Supabase dashboard or hand-written SQL.

## 2. Owner decisions (from the conversation)

1. **Granted plan:** staff pick a plan (Starter, Pro, Business or Enterprise) and an end date or "until revoked". The shop gets full access on that plan. The grant is marked as given by admin, so Stripe events cannot overwrite it. It can be changed or revoked at any time; every change needs a note and is logged.
2. **Shops paying through Stripe:** granting is refused while the shop has a live Stripe subscription. Staff cancel it or let it lapse first.
3. **Users:** see members; add a user by email as cashier or manager (new emails get an invite, existing accounts are linked; counts against the plan's member limit); change role between cashier and manager; disable and re-enable; send a password-reset email. The owner cannot be disabled or demoted. Staff never see or set passwords.
4. **Ownership transfer:** not now. A shop's owner stays fixed, as today.
5. **Admin console look:** restyle it to match the rest of the app instead of keeping the plain 1H layout.

## 3. What already exists

- `subscriptions` (one row per shop: `plan_id`, `status` trialing | active | past_due | canceled, `trial_ends_at`, `grace_ends_at`, `current_period_end`, `canceled_at`, Stripe ids, `addon_tills`) and `access_ends_at()`; `entitlement_overrides` (`kind` manual | extra_till: features and limits, never plan or access); `entitlements_internal()` / `business_entitlements()`; `enforce_plan_limit` triggers (devices, branches, members, products).
- Stripe events go through `apply_billing_event`; every activation sets `plan_id='starter'`, so a plan written into `subscriptions` by hand would be overwritten by the next event.
- Admin action pattern (1H): route → `requireStaff()` → pure parser in `lib/admin/actions.ts` → `security definer` SQL function `admin_*` (service role only) that locks the subscription row, raises P0001 codes and writes `audit_events` (`action='admin.<x>'`, `{before, after, note}`) in the same transaction; UI panels in `components/admin/shop-actions.tsx` with a required note and a confirm step.
- `business_members` (`role` cashier | manager | owner, `status` active | disabled, `unique(business_id, user_id)`); `businesses.owner_id` is immutable; no invite flow and no member RPCs. Cashiers are added today by hand (dashboard user + SQL insert).
- Today a **manager has the same app rights as a cashier** (`lib/access/cashier.ts`); Stage 2 will separate them.
- Email links: `/auth/confirm` verifies `signup | recovery | email` token hashes; templates for confirmation and recovery exist in `supabase/templates/`.

## 4. Goals

### 4.1 Granted plan

- **Storage:** a new `plan_grants` table with history: shop, plan, `starts_at`, `ends_at` (null = until revoked), `granted_by`, `note`, and `revoked_at`, `revoked_by`, `revoke_note`. At most one grant is in force per shop (not revoked, and `ends_at` null or in the future).
- **Effect:** while a grant is in force, `entitlements_internal()` uses the grant's plan for features and limits and gives **full access** regardless of the subscription's status or dates. Overrides and extra tills still apply on top, as today. When the grant ends or is revoked, the shop falls back to whatever its subscription says (for example an expired trial becomes read-only again), with no data changed.
- **Stripe cannot overwrite it:** grants live outside `subscriptions`, and `apply_billing_event` never touches `plan_grants`.
- **Refused when paying through Stripe:** granting is refused while the shop has a Stripe subscription id and its status is not `canceled`. While a grant is in force, the owner's **checkout is refused** too, so a shop is never charged and comped at the same time.
- **Actions on the shop page:** *Grant plan* (plan, "until" date or "until revoked", note), which replaces any grant in force; *Revoke grant* (note). Both log `admin.grant_plan` / `admin.revoke_grant` with before/after.
- **Shop page shows:** the grant in force (plan, until, granted by, note) inside "Plan and billing", and past grants in Activity.
- **Owner sees:** Settings → Billing says "Pro plan, provided by Shop Ledger until 30 Nov 2026" (or "until further notice"), with no upgrade or payment buttons while it lasts. Billing lifecycle banners do not show during a grant.
- **Lowering a plan:** if a grant (or its end) leaves the shop with more active tills than allowed, the existing 1F "choose which till stays" flow handles it. Members over the limit stay; only new members are blocked (the existing trigger).

### 4.2 Shop users

- **Members section** on the shop page: email, role, status, joined date, last sign-in; the owner first.
- **Add a user:** email + role (cashier or manager).
  - The email has no account → Supabase invite email; the person sets a password through the invite link, then lands in the app as a member of this shop.
  - The email has an account → linked straight away; they see this shop the next time they open the app.
  - Refused when the plan's member limit is reached, when the person is already a member here, or when the account already belongs to **another shop** (they would land in the wrong shop: see 7).
- **Change role** cashier ↔ manager; **disable** and **re-enable**. The owner's row is refused for all three.
- **Password reset:** sends the standard reset email to that member. Nothing about the password is shown or set by staff.
- Every action needs a note and is logged (`admin.add_member`, `admin.set_member_role`, `admin.set_member_status`, `admin.send_password_reset`).

### 4.3 Admin console look

- Same visual system as the shop app (midnight-blue tokens, glass top bar, panels, soft-dot pills, shared `.button`, `.input`, `.select`, `.textarea`, `.modal` and `.badge` classes) instead of the 1H Tailwind-only layout.
- **Header:** a glass top bar with "Shop Ledger · Admin", the staff email, and a link back to the shop app; no sidebar (the console has two pages).
- **Shop list:** a page heading, a sticky search/filter bar, KPI-style counts (shops, needing a look, on trial, granted, paying), and the table with status pills; on phones the table stacks into labelled cards like Sales and Inventory.
- **Shop page:** a heading with the shop name and status pills, then panels for Actions, Plan and billing (with the grant), Members, Billing check, Tills, Extras and Activity; on wide screens a two-column layout (details left, actions and members right).
- Actions open in the shared dialog style with the required note; confirmations use the existing confirm dialog.
- Behaviour, routes, data and access are unchanged by the restyle; it works in dark and light, from 360px up.

## 5. Non-goals

- Ownership transfer, deleting accounts, removing members outright (disable is the removal), multi-shop membership for one person.
- Billing a grant (invoices, amounts). A grant records why in its note only.
- Changing what a manager may do (Stage 2).
- Shop owners managing their own team from Settings (a later stage reuses these SQL functions).

## 6. Anti-goals

- Staff never see, set or receive a member's password.
- No "sign in as this user" / impersonation.
- A grant never edits `subscriptions`, so Stripe history and the billing check stay truthful.

## 7. Constraints

- Same security model as 1H: staff checked app-side (`PLATFORM_STAFF_EMAILS`), SQL functions are service-role only, every change is audited, owners never see `admin.%` audit rows.
- One person, one shop: `lib/access/choose-membership.ts` picks a person's highest-ranked membership, so someone who owns another shop would always open that one. Adding such an account is refused rather than silently ignored.
- Forward-only migrations; they are applied to the hosted database before the app release (release checklist).
- The invite email needs a new Supabase template and `invite` accepted by `/auth/confirm`; the hosted-setup notes gain a step for it.

## 8. Testing

- SQL tests: grant gives full access on an expired trial; grant plan's limits apply; revoke and expiry fall back; a Stripe event during a grant leaves the grant in force; grant refused for a live Stripe subscription; checkout refused during a grant; one grant in force at a time; member add refused at the limit / duplicate / owner of another shop; owner row refused for role and status changes; every action writes one audit row.
- Unit tests for the new parsers and refusal messages, and for the owner-facing billing summary during a grant.
- Browser check of the restyled list and shop page (grant panel, members section) and Settings → Billing during a grant, dark and light, 360px to 1920px.

## 9. Designer calls (owner may overrule)

1. **Manager stays selectable** even though it currently means the same as cashier, so Stage 2 can give managers more without re-adding anyone.
2. **Grant reminder:** the shop page marks grants ending within 7 days; the owner sees nothing extra (no warning banner) until it ends.
3. **Re-enabling a disabled member** is refused if it would exceed the member limit.
4. **No sidebar in the admin console:** two pages do not need one; the glass top bar carries navigation.
5. **Shop list counts** (shops, needing a look, on trial, granted, paying) are computed from the same reads the list already makes, so the page makes no extra calls per shop.

## 10. Left to the builder

- Exact SQL shape (a separate `plan_grants` table vs columns on `subscriptions`, as long as Stripe events cannot touch it) and how `entitlements_internal()` reads it.
- Order of invite and member insert so a refused add leaves no half-made account (check first, then invite, then insert).
- Last-sign-in data source (auth admin API at pilot scale).
