# Founding 50 — design

Date: 2026-11-09. A launch offer on top of Stage 1J billing (`2026-10-31-stage-1j-razorpay-design.md`) and Stage 1I
grants (`2026-10-29-stage-1i-admin-grants-and-members-design.md`).

## 1. Goal

Win the first paying shops. The first 50 shops that pay for billo get Pro features and Pro limits for 12 months while
paying the Starter price (AED 99/month or AED 990/year). They are shown as founding members in the app and in the
admin console.

Success:
- Never more than 50 seats are taken, even when many shops pay in the same second.
- A founder gets exactly Pro's features and limits for 12 months from the first real charge, then plain Starter.
- Razorpay billing and admin plan grants behave exactly as before for everyone.
- The owner of billo can see who the founders are and take a seat back.

## 2. Owner decisions (from the conversation)

1. **Fixed period: 12 months** from the first real charge.
2. **Lost on cancel.** If the subscription ends inside the 12 months, the benefit ends. Coming back later never
   restores it (one founder record per shop, ever).
3. **A seat is claimed by the first real payment**, not by signing up or saving a card. A card-saved trial claims
   nothing until the trial ends and the first charge succeeds.
4. **Monthly and yearly both qualify.**
5. **Public site and signup show the offer text without a count.** The text hides when all seats are taken.
6. **Admin: view and revoke.** Staff see founder status and the seats used, and can revoke a seat with a note
   (fraud, abuse). A revoked seat is freed for the next payer.
7. **A cancelled founder's seat stays taken.** The offer is "the first 50 paying shops". Only a staff revoke frees a
   seat.
8. **Upgrade to a higher plan** (no self-serve upgrade exists yet; only Starter is sold): when one exists, an upgrade
   ends the founder benefit and the seat stays taken. Pro already includes everything a founder gets.

## 3. Facts the design rests on

- Razorpay sells only Starter (`lib/billing/provider.ts`). `apply_billing_event` sets `plan_id = 'starter'` whenever a
  paid event makes the shop `active`. A card-saved trial stays `trialing` on `pro` until the first charge.
- `entitlements_internal()` (last body in `202610290040_plan_grants.sql`) picks the plan (a grant in force wins over the
  subscription), then adds `entitlement_overrides` features and limits, the extra till and add-ons on top.
- A plan grant is refused while a billing subscription is live, and while a grant is in force the owner's checkout is
  refused. So a grant cannot express "pays Starter, gets Pro".

## 4. Data model

New migration `202611090049_founding_50.sql`.

```sql
create table public.founding_offer (
  id boolean primary key default true check (id),   -- singleton row
  seat_cap integer not null default 50 check (seat_cap >= 0),
  months integer not null default 12 check (months > 0)
);
insert into public.founding_offer default values;

create table public.founding_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses (id) on delete cascade,
  seat_no integer not null check (seat_no > 0),
  claimed_at timestamptz not null default now(),
  ends_at timestamptz not null,
  billing_event_id text not null,          -- the event that claimed it
  ended_at timestamptz,
  end_reason text check (end_reason in ('canceled', 'revoked', 'upgraded')),
  revoked_by uuid references auth.users (id),
  revoke_note text,
  check ((ended_at is null) = (end_reason is null))
);
-- A seat number belongs to one live (not revoked) founder; a revoked seat number may be reused.
create unique index founding_members_seat_taken on public.founding_members (seat_no) where end_reason is distinct from 'revoked';
```

Both tables: RLS on, no policies, `revoke all` from `public, anon, authenticated`, `select` to `service_role`.
Writes only happen inside the security-definer functions below.

**Seats taken** = rows whose `end_reason` is not `'revoked'` (active, cancelled or upgraded founders all hold a seat).
**Active founder at time t** = a row with `ended_at is null and claimed_at <= t and ends_at > t`.

## 5. Claiming a seat

A new function `public.claim_founding_seat(p_business uuid, p_event_id text)`, called at the end of
`apply_billing_event` (in the same transaction, after the subscription update) when all of these are true:

- the event was `applied` (not duplicate, stale, superseded or unknown);
- `v_kind in ('checkout_completed', 'invoice_paid', 'subscription_changed')`;
- the shop's row is now `status = 'active'` and `plan_id = 'starter'`.

`claim_founding_seat`:

1. Returns at once if a `founding_members` row exists for the shop (one record per shop, ever; a revoked or cancelled
   founder never claims again).
2. Locks the singleton: `select * from founding_offer for update`. Every claim queues on this lock, so the count and
   the insert happen one at a time.
3. Counts seats taken. If `>= seat_cap`, returns.
4. Picks the lowest free seat number (`generate_series(1, seat_cap)` minus seats taken), inserts the row with
   `ends_at = now() + make_interval(months => founding_offer.months)` and writes an `audit_events` row
   ("Founding member seat N claimed").

`apply_billing_event` is rewritten with `create or replace` from the body in `202610310043_razorpay_billing.sql`; the
only additions are the claim call and the end-on-cancel update in §6. Its return values do not change.

Why "active + starter after an applied event" is "the first real payment": a trial checkout leaves the shop
`trialing`; the zero-amount trial invoice is handled by the trial branch and leaves it `trialing`; the shop becomes
`active` only through a successful charge (`invoice_paid`), a checkout after the trial has run out (charged at once),
or Razorpay reporting the subscription `active` (which follows the first charge).

## 6. Ending the benefit

- **Cancel:** in `apply_billing_event`, the `subscription_deleted` branch also sets
  `ended_at = v_created, end_reason = 'canceled'` on an open founder row. Past-due grace does not end it.
- **12 months pass:** nothing is written. `ends_at` is in the past, so the entitlement check stops applying it. Razorpay
  keeps charging the Starter price, as it always did.
- **Revoke (staff):** `public.admin_revoke_founding_seat(p_business uuid, p_actor uuid, p_note text)`, service role
  only, same shape as `admin_revoke_grant`: cleans the note with `admin_clean_note`, refuses with `not_a_founder` if
  there is no row or it is already revoked, sets `ended_at = now(), end_reason = 'revoked', revoked_by, revoke_note`,
  and writes an `audit_events` row. The seat number is free for the next claim.
- **Upgrade:** reserved (`end_reason = 'upgraded'`) for when a Pro checkout exists. Nothing writes it in this build.

## 7. Entitlements

`entitlements_internal()` is rewritten with `create or replace` from the body in `202610290040_plan_grants.sql`.
Changes:

- After the plan is chosen: if no grant is in force and an active founder row exists at `at_time`, the plan used for
  `features` and `limits` is the `pro` row of `plan_catalog`. `planId` stays the subscription's (`starter`).
- Overrides, the extra till and add-ons stack on top exactly as before.
- A new key `founder` is always returned: `{"seatNo": n, "endsAt": "<ts>"}` while active, otherwise `null`.
- A grant in force wins: the founder is ignored and `founder` is `null` for the length of the grant.

Feature checks in the app (`hasFeature`) read `features` and need no change.

In `lib/billing/entitlements.ts` the zod schema gets
`founder: z.object({ seatNo: z.number().int().positive(), endsAt: z.string() }).nullable().default(null)`, so cached
entitlements written before this change still parse. `READ_ONLY_ENTITLEMENTS` gets `founder: null`.

When the 12 months end, a founder over Starter's limits (2 tills, 5 users, unlimited products) is handled by the
existing over-limit paths (choose active tills, member and product limits), the same as when a Pro trial ends.

## 8. Public offer flag

`public.founding_offer_open()` returns `boolean` (seats taken < cap). Security definer, `grant execute` to `anon,
authenticated`. It returns only the boolean, never a count or shop data.

## 9. Screens

- **Settings → Billing** (`components/billing/billing-panel.tsx`): while `founder` is set, a line
  "Founding member #N: Pro features at the Starter price until <date>." In the last 30 days before `endsAt` it adds
  "After that, Starter limits apply."
- **Admin shop page** (`app/admin/shops/[id]`): a "Founding member #N" badge with the claimed and end dates, or the
  ended reason and date. A "Revoke founder seat" action with a required note, behind the same staff check and
  confirm pattern as revoking a grant.
- **Admin shop list:** a line "Founding 50: N of 50 seats taken" (service role read).
- **Public site:** the plan picker on the home page (`components/public/landing/plan-picker.tsx`) and the signup page
  show "Founding 50: the first 50 shops to subscribe get Pro features for 12 months at the Starter price." Shown only
  while `founding_offer_open()` is true; the pages revalidate at most hourly, so the text can stay up to an hour after
  the last seat goes. If the check fails, the text is hidden.

## 10. Testing

- **SQL** (`supabase/tests/founding_50_test.sql`, one transaction, rolled back, same style as `staff_pins_test.sql`):
  - trial `checkout_completed` claims no seat; the first `invoice_paid` after the trial claims seat 1;
  - a checkout after the trial ran out claims a seat at once;
  - a duplicate (redelivered) event claims nothing more; a second paid event for the same shop claims nothing more;
  - seat 51 is refused when 50 are taken (cap lowered in the test to keep it fast, plus one run at 50);
  - `subscription_deleted` ends the benefit; a later checkout and payment for the same shop does not claim again;
  - revoke frees the seat number and the next payer gets it; revoking twice is refused;
  - entitlements: a founder gets Pro features and limits with `planId = 'starter'` and `founder` set; a non-founder
    on Starter gets Starter; after `ends_at` (via `at_time`) a founder gets Starter and `founder = null`; a grant in
    force hides the founder; add-ons and overrides still stack;
  - `founding_offer_open()` flips to false at the cap; anon can call it and cannot read either table.
- **Concurrency** (`scripts/founding-50-race.mjs`, local Supabase only, refuses any non-local URL): creates 60 shops,
  fires their first `invoice_paid` through `apply_billing_event` on 60 parallel connections, asserts exactly 50
  founder rows with seat numbers 1–50, then deletes what it created.
- **Unit** (`npm test`, `tests/founding-50.test.mjs`): the zod schema parses with and without `founder`; the billing panel text for active,
  ending-soon and no founder.
- **Browser** on local Supabase: drive a shop to paid with the pretend billing events, check Settings → Billing,
  the admin badge, revoke, and the home page offer text.

## 11. Out of scope

- A public count of seats left.
- Reminder emails before the 12 months end.
- Self-serve upgrade to Pro (and so the `upgraded` end reason in practice).
- Staff granting a founder seat by hand.

## 12. Rollout

The migration is applied to production only on the owner's explicit go-ahead. Shops that are already paying when it
ships do not get seats backdated; the first seat goes to the first payment after the migration runs.
