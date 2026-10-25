# Stage 1H — Internal admin console (design)

**Status:** draft for owner review · **Date:** 2026-10-25 · **Branch:** `stage-1h-admin`
**Parent spec:** `docs/superpowers/specs/2026-10-11-saas-plans-and-improvements-design.md` ("Internal admin console (`/admin`, restricted to a platform-staff allowlist): list tenants, extend trials, set overrides, view subscription status"; "A daily reconciliation job compares Stripe and `subscriptions`").
**Carry-over:** the daily Stripe ↔ `subscriptions` reconciliation job, deferred from 1F.

## 1. Intent

When a shop owner writes in ("can I have a few more trial days?", "my billing looks wrong"), the platform owner opens one page, finds the shop, sees its plan and billing state at a glance, and fixes what needs fixing — without touching the database by hand.

## 2. Owner decisions (from the conversation)

1. **Jobs:** see the shop, extend its trial, check its billing.
2. **Who:** only the platform owner for now (one person).
3. **Shop page shows:** plan, trial end date, payment status, tills, owner email.
4. **Extras by hand:** give a shop an extra till for a while (until a chosen date).
5. **Billing disagreements:** a daily check compares each shop's record with Stripe; disagreements are **flagged in the admin console** for the owner to look at — never fixed automatically.

## 3. What already exists

- `subscriptions` (plan, status, trial_ends_at, grace_ends_at, current_period_end, cancel_at, canceled_at, Stripe ids, has_payment_method, billing_interval, last_event_at), `stripe_events`, `entitlement_overrides` (features, max_tills and other limits, expires_at, note), `entitlements_internal()` which already applies non-expired overrides, `audit_events`.
- Billing provider (`lib/billing/provider.ts`: stripe | pretend | none), the service-role admin client (`lib/supabase/admin.ts`, server only).
- 1F till-limit behaviour: when a shop has more active tills than allowed, the owner chooses which till stays at the next register open.

## 4. Goals

### 4.1 Access
- `/admin` and every `/api/v1/admin/*` route are for platform staff only: the signed-in user's **email is in the `PLATFORM_STAFF_EMAILS` allowlist** (server environment variable, comma-separated, compared case-insensitively) **and** the email is confirmed. Everyone else gets 404 (the console's existence is not revealed) *(designer call)*.
- The allowlist lives only in server env (`.env.local` locally, hosting settings in production) — never in the database or the client bundle.
- All admin reads and writes run on the server with the service-role client, after the staff check. No new RLS policies; shops never see admin data.
- A staff member does not need a shop; `/admin` is outside the shop layout (no AuthGate shop/till requirement).

### 4.2 Shop list (`/admin`)
- Search by shop name, owner email, TRN or shop id; newest first; pages of 50.
- Columns: shop name, owner email, plan, status in plain words (e.g. "Pro trial · 6 days left", "Starter · active", "Payment failed · grace ends 26 Oct", "Read-only"), created date, and a red **Needs a look** badge when the billing check has an open flag.
- A filter "Needs a look only".

### 4.3 Shop page (`/admin/shops/<id>`)
- **Shop:** legal name, TRN, phone, country, created date, owner email (and whether it is confirmed).
- **Plan and billing:** plan, status in plain words, trial end, grace end, current period end, cancel date, payment method on file, billing interval, Stripe customer and subscription ids (copyable), last Stripe event time.
- **Tills:** number, name, branch, status (active / paused / revoked), and "N of M allowed" using the shop's effective limit.
- **Extras:** active and past overrides with their note and expiry.
- **Billing check:** open flags with what disagrees (field, our value, Stripe's value, first seen), and the last time the shop was checked.
- **Activity:** the last 20 admin actions on this shop (who, what, when, note).

### 4.4 Actions (on the shop page)
- **Extend trial:** choose new end date (or "+7 days" / "+14 days"); required note. Allowed only while the shop is trialing (including a trial that has just run out and is read-only because of it). Sets `trial_ends_at`; access returns at the shop's next entitlement refresh. Refused for paid or canceled subscriptions, with a plain message.
- **Give an extra till until …:** date (required, in the future) and note. Creates an `entitlement_overrides` row with `max_tills = plan's tills + 1` and that expiry. When it expires, the 1F till choice applies at the next register open (the owner picks which till stays). An active extra-till override can be **ended now** (sets expiry to now) *(designer call)*.
- **Mark a billing flag as looked at:** with a note; the flag closes (it reopens if the next check still disagrees).
- **Run billing check now** for this shop.
- Every action writes an `audit_events` row (actor = staff user, action `admin.*`, summary with before/after values and the note) *(designer call: reuse the existing audit table)*.
- Every action asks for confirmation in the in-app dialog, showing the shop name.

### 4.5 Daily billing check
- A server job compares, for every shop with a Stripe subscription id, our `subscriptions` row with Stripe's subscription: status (mapped the same way the webhook maps it), current period end (±1 hour), cancel-at, trial end, and whether the Stripe subscription still exists.
- Disagreements become **flags** (stored per shop + field; one open flag per shop + field; updated with the latest values and `last_seen`). Agreement closes nothing on its own — only "looked at" closes a flag, and a flag still disagreeing reopens on the next run *(designer call: the owner said "flag it for me to look at")*.
- **Never changes `subscriptions`.**
- Runs once a day from a scheduled call to `POST /api/v1/admin/billing-check` protected by a secret header (`ADMIN_CRON_SECRET`, server env); the scheduler is whatever hosts the app (e.g. Vercel Cron or Supabase scheduled function) — wiring the schedule on the hosted side is an owner step, documented in a notes file *(designer call)*.
- Provider `pretend` (local): the check compares against the pretend provider's view (the local row itself), so it runs end to end with no flags unless a test injects a difference; provider `none`: the job reports "Billing is not set up" and does nothing.
- The shop list's "Needs a look" badge and a count on `/admin` show open flags.

## 5. Non-goals
- More than one staff member, staff roles, or staff management UI (the allowlist is edited in the environment).
- Editing shop details, impersonating a shop, deleting shops, refunds or invoices from the console.
- Changing a shop's plan or Stripe subscription from the console (done in Stripe's dashboard).
- Other override kinds (features, branches, members, products) — the table supports them; the UI offers only the extra till.
- Automatic fixes from the billing check.

## 6. Anti-goals
- Anyone not on the allowlist can see that `/admin` exists, read any shop's data, or call an admin route.
- The service-role key or any admin data reaches the browser of a non-staff user.
- An admin action changes a shop without an audit row and a note.
- The billing check changes a shop's subscription.

## 7. Constraints
- Local Supabase only; never push to or call the hosted project. Allowlist and cron secret only in `.env.local` locally.
- Next.js 16 (read `node_modules/next/dist/docs`); service-role client only in server code.
- No new runtime dependencies (Stripe SDK already present).

## 8. Testing
- Unit: staff check (allowlist parsing, case, unconfirmed email, missing env → nobody is staff), plain-word status, effective till limit with an override, billing comparison (each field, tolerance, missing subscription), flag open/update/close/reopen rules.
- SQL: extending a trial and adding/ending an override via the admin functions are service-role only; audit rows are written; the till limit honours the override until it expires.
- Route: non-staff → 404 for pages and APIs; cron route without/with a wrong secret → 404, identical to a missing route (ruled during the build: §6 — nobody off the allowlist can tell the admin API exists — beats the 401 first written here); with the secret → runs.
- Browser (local, pretend provider): staff opens `/admin`, searches a shop, extends a trial (read-only shop becomes usable after refresh), gives an extra till (a third till can be registered on Pro), ends it (till choice at next register open), runs the billing check, a flag injected in the test shows "Needs a look", marks it looked at; a normal owner gets 404 on `/admin`.

## 9. Designer calls (owner may overrule)
1. Staff = email in `PLATFORM_STAFF_EMAILS` + confirmed email; others get 404.
2. Admin actions are audited in the existing `audit_events` table with a required note.
3. An extra till can be ended early.
4. Billing flags close only when marked "looked at" and reopen if still wrong.
5. The daily check is a secret-protected route called by the host's scheduler; scheduling it is a documented owner step.
6. Extend trial is offered only for trials (including just-expired ones). A trial with a card on file is refused with "Change the trial end in Stripe" — Stripe holds that trial end, and changing only ours would trip the billing check.
7. One extra-till override at a time per shop (a new one replaces the active one).
8. The staff member signs in with a normal account; `/admin` sits outside the shop layout, so having no shop is fine.
9. Billing flags live in a new table readable only by the service role.

## 10. Left to the builder
Page layout within the existing design tokens, the flags table shape, search implementation, and copy for minor errors.
