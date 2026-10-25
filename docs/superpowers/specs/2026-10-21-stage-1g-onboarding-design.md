# Stage 1G — Signup, onboarding and cashier access (design)

**Status:** draft for owner review · **Date:** 2026-10-21 · **Branch:** `stage-1g-onboarding`
**Parent spec:** `docs/superpowers/specs/2026-10-11-saas-plans-and-improvements-design.md` (Stage 1: "self-serve signup → country (UAE) → business details → onboarding checklist")
**Sub-plan row:** `docs/superpowers/plans/2026-10-11-stage-1-starter-launch.md` — 1G. Carry-overs from 1F folded in by the owner: cashier access, the cashier till picker, the till-limit gap.

## 1. Intent

A shop owner in the UAE can go from the website to their first sale without anyone helping: create an account, confirm their email, set up the shop, then follow a short checklist — add products, open the register, make a first sale.

Cashiers the owner adds can actually work: today they can sign in but cannot read products, customers, sales or the register, so a hosted cashier cannot sell. 1G gives them exactly what selling needs and nothing more.

## 2. What exists today

- `/login` (email + password, "Try the sample shop"); no way to create an account — accounts are made by hand.
- `/setup` (`components/business-setup.tsx`): legal name, TRN (15 digits), phone, invoice prefix, address, receipt footer, device name; country fixed to the first enabled profile (UAE, AED). Creating a business starts the 14-day Pro trial (1A trigger).
- AuthGate sends a signed-in user without a business to `/setup`, and a user without a till to the till picker.
- Row-level security: owners read and write everything; members (`has_role(business_id, 'cashier')`, which ranks manager and owner above cashier) can read the business, team, branches and (since 1F) devices — **not** products, customers, sales, sale items, credit notes, register sessions, cash movements or stock movements.
- The till picker offers "Register a new till" to everyone, though only owners may add tills.
- 1F residual: an owner can insert a till already `paused` and sync a register open backdated just before its pause stamp, then sell on it indefinitely — extra tills on Starter.

## 3. Owner decisions (from the conversation)

1. **The flow:** sign up → set up the shop → a checklist.
2. **Checklist steps:** add products, open the register, make a first sale.
3. **Email must be confirmed** before the app can be used.
4. **Signup screens (mockup Part 1, accepted):** "Start your free trial — 14 days of Pro. No card needed." with name, email, password; then "Check your email" with "Send the link again" and "Wrong address? Start again"; then the existing shop setup.
5. **Checklist look (mockup option B):** a thin strip on every page — "Get ready to sell · 1 of 3 · Next: <step>" with a button for the next step — until all three are done. It shares the space under the top bar with the billing banner; the billing banner wins.
6. **Carry-overs are in 1G.**
7. **What a cashier can see:** products, customers, today's register and today's sales — not past sales, reports or other owner pages.
8. **Refunds by cashiers:** a cashier can refund **any** sale of the shop when they have its invoice number (a returning customer brings the receipt); they still cannot browse past sales.

## 4. Goals

### 4.1 Signup
- New page `/signup`: name, email, password (at least 8 characters), "Create account". Link from `/login` ("New here? Start your free trial") and back ("Already have an account? Sign in").
- Uses Supabase Auth email + password sign-up with email confirmation on; the name is stored in the user's metadata. The confirmation link returns to the app (an auth callback route) and continues to `/setup`.
- "Check your email" screen: shows the address, "Send the link again" (Supabase resend; disabled for 60 seconds after each send), and "Wrong address? Start again" (back to `/signup`).
- Signing in with an unconfirmed email shows "Confirm your email first. We sent a link to <email>." with the same resend button.
- Errors in plain words: weak password → the rule; network → "Could not reach the server. Try again." An email that already has an account gets the same "Check your email" screen (Supabase hides it, and the form must not reveal who has an account) *(designer call)*.
- Confirmation and reset links work when opened on another device (e.g. the phone): use Supabase's token-hash verification links (email template `{{ .TokenHash }}` → an app route that calls `verifyOtp`), not the same-browser code exchange *(designer call)*.
- Local testing: `supabase/config.toml` gets `enable_confirmations = true`, the local mail catcher enabled, and `site_url` / redirect URLs for `http://localhost:3101`. Test and smoke accounts are created already confirmed through the admin API.
- A signed-in user who opens `/signup` goes to `/overview` (or `/setup` if they have no shop).
- **Forgot password** *(designer call)*: "Forgot password?" on `/login` → email → Supabase reset link → `/reset-password` to choose a new one. Same mail setup as confirmation, so it costs little and owners will need it.

### 4.2 Shop setup
- Keep `/setup` as it is (UAE only), with the heading "Set up your shop" and one line: "Country: United Arab Emirates · prices in AED" (already shown). The 14-day Pro trial starts when the shop is created (existing).
- After setup the owner lands on `/overview` with the checklist strip.

### 4.3 Checklist strip
- Owners only; never in the sample shop.
- Progress comes from a small owner-only server function returning three flags (has an active product, has ever opened a register session on any till, has any sale), refreshed with the snapshot — the local snapshot holds only 60 days and this till's register *(designer call)*. Steps and their "done" rule:
  1. **Add your products** — the shop has at least one active product. Button: "Add products" → `/inventory`.
  2. **Open the register** — the shop has ever opened a register session. Button: "Open register" → `/register`.
  3. **Make your first sale** — the shop has at least one sale. Button: "New sale" → `/sale`.
- Text: "Get ready to sell · N of 3 · Next: <step name>" + the step's button. When all three are done the strip shows once "You're ready to sell." for the rest of that page visit, then never again.
- No "Hide" button *(designer call: three steps, and it finishes itself)*.
- Placement: the banner slot under the top bar; if a billing banner is showing, the billing banner shows instead (one banner at a time).

### 4.4 Cashier access (carry-over)
- Members (cashier and above) may **read**: products, customers, register sessions and cash movements of the **open** session or sessions opened today (Dubai date), sales and sale items and credit notes and their items whose supply date is **today (Dubai)** or that belong to an open register session, and stock movements are **not** needed. Owners keep reading everything.
- Members may **create** customers at checkout (through the existing customer sync path; verify the sync RPCs already accept a cashier — they are security definer — and only fix what blocks a cashier).
- The snapshot for a cashier contains only what they may read; the hosted store must not treat the missing older sales as deletions of the owner's data (it is per user already — verify).
- Cashier navigation: Overview, Sales (today only: the date chips other than "Today" are hidden and server search is off for cashiers), New sale, Inventory (read-only: no add, edit, import or archive), Customers (add allowed), Register. Hidden: Reports, Settings except the Data tab's "Sync now" and outbox *(designer call)*.
- "Today's sales" for RLS means: the sale's supply date is today in Dubai, **or** the sale's `register_session_id` is a session that is still open (a shift that runs past midnight keeps its sales visible) *(designer call)*.
- **Refund by invoice number** (owner decision 8): on Sales, a cashier types an exact invoice number into "Refund a sale by invoice number"; a member-only server function returns that one sale (with its items and existing credit notes) for this business, or "No sale with that invoice number." The cashier then refunds it through the existing refund flow; the credit-note sync accepts a cashier for any sale of their business. Partial matches and browsing are not offered. Owners keep their full search.
- The snapshot route selects for the caller's role explicitly (a cashier's snapshot holds only today's sales, credit notes of today, the open register); the hosted store merge must not delete local work because older rows are absent — verify and fix if it does. Stock movements are left out of a cashier's snapshot.
- Pages a cashier cannot use redirect to `/overview` when opened by address; server routes keep their existing owner checks (verify `/api/v1/business` PATCH is owner-only and fix if not).

### 4.5 Till picker for cashiers (carry-over)
- Non-owners do not see "Register a new till"; they see "Ask the shop owner to add a till." when no till is available.

### 4.6 Till-limit gap (carry-over)
- A till can only become `paused` (or leave `paused`) through `choose_active_till` and other security-definer server functions. Inserting a till with any status other than `active`, or an owner directly setting or clearing `paused`, is refused by the server; other existing status changes (e.g. `revoked`) keep working; the till limit check stays as is.
- With this, every paused till was once a real active till within the limit, so the 72-hour grace for a shift that was already running stays as built in 1F.

## 5. Non-goals
- Other countries (the country step stays fixed to UAE).
- Inviting staff from the app (adding a cashier stays a manual/admin task until a later stage) — 1G only makes an existing cashier work.
- Social sign-in, magic links, phone sign-up.
- Product templates or sample-product import in the checklist (the 1D import already exists and is linked from Inventory).
- Configuring the hosted Supabase project's email sender (SMTP). That is a one-time owner task in the Supabase dashboard; locally, Supabase's built-in mail catcher is used for testing.

## 6. Anti-goals
- Anyone uses the app with an unconfirmed email.
- A cashier can read past sales, reports, or another shop's anything.
- Signing up creates a shop or a trial before the email is confirmed and the setup form is submitted.
- The checklist nags a shop that is already trading (a shop with products, a register and a sale never sees it).

## 7. Constraints
- Local Supabase only for development and tests; never push to or call the hosted project. Test accounts' credentials live only in the git-ignored `.env.local`.
- Supabase Auth settings for local testing go in `supabase/config.toml` (email confirmations on, the local mail catcher enabled, redirect URLs for `http://localhost:3101`).
- Next.js 16: read `node_modules/next/dist/docs` before writing routes and pages (auth callback route).
- No new runtime dependencies.

## 8. Testing
- Unit: checklist step logic from data (0, 1, 2, 3 done; sample shop; cashier), signup form validation and error mapping, cashier navigation filter.
- SQL: as a cashier — reads today's sales and the open register, not yesterday's sales or another shop's; reads products and customers; can create a customer through sync; cannot insert a paused till or update a till's status directly (owner too); `choose_active_till` still pauses.
- Browser (local, mail catcher): sign up → "Check your email" → open the link from the local mail catcher → setup → Overview with "1 of 3"; resend works; unconfirmed sign-in message; forgot password round trip; strip progresses to done and disappears; cashier signs in, picks the till, sees products and today's sales only, cannot open Reports, has no "Register a new till".

## 9. Designer calls (owner may overrule)
1. Forgot password is included.
2. Checklist progress is worked out from the shop's data, not stored.
3. No "Hide" on the strip.
4. Cashier pages: Reports and most of Settings hidden; Inventory read-only; Sales shows today only.
5. Only `choose_active_till` (and other server functions) can pause or un-pause a till; direct writes of `paused` are refused.
6. A duplicate-email sign-up shows "Check your email" (no account enumeration).
7. Email links use token-hash verification so they work on another device.
8. Checklist flags come from a small owner-only server function.
9. "Today's sales" includes sales of a still-open register session past midnight.
10. Hidden cashier pages redirect to Overview when opened by address.

## 10. Left to the builder
Page styling within the existing auth pages, the exact auth-callback route shape, how the cashier's "today" filter is expressed in RLS (a policy helper is fine), and copy for minor errors.
