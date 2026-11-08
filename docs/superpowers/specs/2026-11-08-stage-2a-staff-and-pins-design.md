# Stage 2A: Staff roles and cashier PINs — design

Date: 2026-11-08. First sub-project of Stage 2 (Pro tier) in `2026-10-11-saas-plans-and-improvements-design.md` §5.

Stage 2 is split into sub-projects, each with its own spec, plan and build, in this order:
2A staff roles and cashier PINs → 2B split payment → 2C categories and margin → 2D suppliers and purchase orders →
2E promotions → 2F weighed items and scale barcodes → 2G serial/IMEI and warranties → 2H advanced reports →
2I WhatsApp/email receipts and alerts. Pilot-shop feedback may move 2F or 2G earlier.

## 1. Goal

Several people share one counter computer. Each sale, refund and cash count must say who did it, without signing
the till out and in. Managers approve the risky actions on the spot. The owner runs staff from Settings instead of
asking billo staff to add people through the admin console.

Success:
- A cashier takes over the till in under five seconds: tap name, enter PIN.
- Every record made on a PIN-locked till names the person behind the PIN, and, where needed, the approving manager.
- Switching and approvals work with no internet, like selling.
- An owner can invite, change, disable and reset staff without contacting billo.

## 2. Owner decisions (from the conversation)

1. **Shared sign-in, PIN switch.** The till stays signed in to the owner's account. Staff take over by tapping their
   name and entering a 4-digit PIN.
2. **Staff are full accounts with an email.** The owner invites them from Settings → Staff; each also has a PIN.
3. **Fixed roles, not per-person permissions.** Cashier sells. Manager also approves returns and refunds, discounts
   above a set percentage, removing items from a sale, opening and closing the register, and edits products and
   stock. Owner can do everything.
4. **Idle lock and Switch.** The till locks after a set number of idle minutes (owner chooses, default 5) and when
   someone taps Switch. No PIN per sale.
5. **PINs are checked on the till**, so switching and approvals work offline. The PIN is an accountability check
   ("who is at the till"), not a security boundary; the owner's sign-in protects the data.

Assumptions stated in the conversation and not corrected:
- PIN lock and manager approvals are Pro (`staff_roles` feature). Starter is unchanged: up to 2 users, each with
  their own email sign-in.
- "Large discount" means above 10% of the sale by default; the owner can change it.
- Records made before 2A keep the signed-in account as the person who made them.
- Five wrong PINs block that person on that till for five minutes.

## 3. What already exists

- `business_members` (`role` cashier | manager | owner, `status` active | disabled, `unique(business_id, user_id)`),
  `has_role()`, and `enforce_plan_limit` on members. `businesses.owner_id` is immutable.
- Admin member functions from Stage 1I (`admin_*`, service role only): add by email (new emails get an invite,
  existing accounts are linked), change role between cashier and manager, disable and re-enable, password-reset email;
  owner cannot be disabled or demoted; each writes `audit_events` with before/after and a note.
- Every synced record has `created_by` = the signed-in account (`auth.uid()`), set by the sync RPCs
  (`sync_sale`, credit note, register, stock, product, customer).
- A manager has the same app rights as a cashier today (`lib/access/cashier.ts`, owner decision 7 of Stage 1E).
- Multiple tills exist (Pro allows 2; choose-active-tills flow). `FeatureGate` and `useEntitlement` gate Pro features.
- The snapshot (`lib/snapshot/types.ts`) carries `business`, `devices`, `role` and `state`; the till caches it in
  IndexedDB and queues writes in an outbox (`SyncOperation`).
- Email templates `supabase/templates/invite.html` and `/auth/confirm` exist.

## 4. Data and server

### 4.1 Staff fields

`business_members` gains:
- `display_name text` — shown on the lock screen; defaults to the part of the email before `@` until set.
- `pin_hash text`, `pin_salt text`, `pin_set_at timestamptz` — null when no PIN is set.

PINs are 4 digits. The device derives the hash with PBKDF2-SHA256 (Web Crypto), 100,000 iterations, a random
16-byte salt per member, 32-byte output, both stored base64. The server only ever receives hash and salt. Two members
of one shop may have the same PIN, because staff choose their name first.

### 4.2 Shop settings

`businesses` gains:
- `pin_lock_enabled boolean not null default false`
- `idle_lock_minutes smallint not null default 5 check (between 1 and 60)`
- `manager_discount_pct smallint not null default 10 check (between 0 and 100)`

Turning `pin_lock_enabled` on is refused with `feature_not_in_plan` when the shop's entitlements lack `staff_roles`,
and with `pin_not_set` when the owner has no PIN.

### 4.3 Who did what

New nullable columns `operator_member_id uuid` and `approved_by_member_id uuid` (both referencing
`business_members(id)`) on: sales, credit notes, register sessions (open and close), cash adjustments and stock
movements.

The sync RPCs accept both fields in their payloads. For each:
- the member must belong to the same business and be `active`;
- an approver must be `manager` or `owner`.

If a check fails the record is **still saved** (a sale is a legal tax record, and Stage 1 never blocks syncing issued
invoices), the failing field is stored as null, and the RPC writes an `audit_events` row
`action='sync.operator_unverified'` with the record id, the field and the reason. Records without the fields
(pre-2A tills, PIN lock off) keep today's behaviour: `created_by` identifies the account.

### 4.4 Staff management functions

Owner-scoped `security definer` functions mirroring the 1I admin ones, sharing their internals so both paths enforce
the same rules and write the same audit rows (`action='staff.<x>'`, actor = owner):
- `staff_invite(email, display_name, role)` — role cashier | manager. New emails get the invite email; existing
  accounts are linked. Counts against the plan's member limit (`plan_limit_reached`).
- `staff_set_role(member_id, role)`, `staff_set_status(member_id, status)` — owner row refused (`owner_protected`).
- `staff_reset_pin(member_id)` — clears hash, salt and set-at.
- `staff_resend_invite(member_id)`.
- `staff_set_pin(member_id, pin_hash, pin_salt)` — allowed for the owner (any member of the shop, used by "Set PIN
  at this till") and for the member themself.
- `shop_set_lock_settings(pin_lock_enabled, idle_lock_minutes, manager_discount_pct)` — owner only.

Next.js routes under `/api/v1/staff/*` call these with the user's session (not the service role), parse input with a
pure parser module, and map P0001 codes to typed errors. Codes: `pin_not_set`, `member_disabled`,
`owner_protected`, `plan_limit_reached`, `feature_not_in_plan`, `not_owner`.

### 4.5 What the till downloads

The snapshot gains `staff` and `lockSettings`:
- `lockSettings`: `{ pinLockEnabled, idleLockMinutes, managerDiscountPct }` — for every member.
- `staff`: `[{ memberId, displayName, role, status, pinHash, pinSalt }]` — **only when the signed-in account is the
  owner**. A cashier or manager signed in on their own device never receives other members' hashes.

`pinLockEnabled` is effectively false whenever entitlements lack `staff_roles` (plan lapse turns the lock off at the
next sync).

## 5. The till

### 5.1 Lock screen

When `pinLockEnabled` is true on an owner-signed-in till:
- On load, after Switch, and after `idleLockMinutes` without pointer, touch or key input, a full-screen lock panel
  covers the app.
- It shows one large tile per active member (name and role). Members without a PIN show "PIN not set" and cannot be
  chosen. Disabled members are not shown.
- Tapping a tile opens a PIN pad: four dots, large keys, keyboard digits and Backspace work.
- A correct PIN unlocks as that person. A wrong PIN shakes the dots. Five wrong tries block that person on this till
  for five minutes; the count is kept per till and clears on success.
- PIN verification is constant-time on the derived bytes.

### 5.2 While unlocked

- The header shows "Aisha · Cashier" and a **Switch** button (keyboard shortcut to be picked in the plan, not one in
  use today).
- The current operator is held in memory and in session storage for the tab; it never syncs on its own.
- Pages follow the operator's role, not the signed-in account:
  - Cashier: today's member pages (overview, sale, sales, read-only inventory, customers, register view; Settings →
    Data only).
  - Manager: as cashier, plus product and stock editing.
  - Owner: everything.
- Every record created carries `operator_member_id` = the operator at the moment it is completed.

### 5.3 A sale in progress at lock time

The cart and the payment step are kept. Whoever unlocks next continues, and the sale is credited to whoever
completes the payment.

### 5.4 Manager approval

When the operator is a cashier, these actions open a "Manager approval" dialog before they go ahead:
- a return or refund (credit note);
- a discount above `managerDiscountPct` of the sale;
- removing a line from the cart or lowering its quantity;
- opening or closing the register.

The dialog lists active managers and the owner who have a PIN. One enters their PIN; the action goes ahead once and
records `approved_by_member_id`. Cancel leaves everything as it was. A manager or owner doing the action is not asked.
Wrong PINs here count toward the same five-try block.

### 5.5 PIN lock off

With `pinLockEnabled` false (or on Starter), the till behaves exactly as today and sends no operator fields.

## 6. Settings → Staff

A new tab, owner only (cashiers and managers keep their current Settings view, plus a "Your PIN" card).

- **Staff list:** name, email, role, Active/Disabled, PIN set / "PIN not set", last used a till. Row actions:
  change role, disable/re-enable, reset PIN, resend invite, set PIN at this till. The owner's row has none.
- **Invite staff:** name, email, role → invite. At the member limit: "Your plan allows N users" and an upgrade link
  instead of Send.
- **Your PIN:** set or change the owner's PIN (typed twice).
- **Set PIN at this till:** the owner opens it on a staff row and hands over the till; the person types the PIN
  twice. Hashing happens on the device.
- **Lock settings:** PIN lock switch, idle minutes (1–60), manager discount % (0–100). On Starter these show as a Pro
  feature with the existing upgrade prompt.
- A staff member signed in on their own device sees a "Your PIN" card (set or change) and the Data tab.
- The admin console's members panel keeps working; it calls the same SQL internals.

## 7. Offline and failure behaviour

- Staff list, hashes and lock settings are cached with the snapshot in IndexedDB. Lock, unlock and approvals work
  offline.
- Staff changes made elsewhere reach an offline till at its next sync. Until then a just-disabled person can still
  unlock that till; their records sync with the operator stored as null and a `sync.operator_unverified` audit row.
- Outbox payloads carry the operator and approver ids, so records made offline keep them.
- A plan lapse turns the lock off at the next snapshot; existing records keep their ids.
- Losing the session-storage operator (tab reload) shows the lock screen again.

## 8. Testing

- **Unit** (`tests/*.test.mjs`): PIN hash and verify against fixed vectors; five-try block and reset; idle timer
  decisions; the approval rule (which actions need a manager for each role and discount); page access by operator
  role; snapshot parsing of `staff` and `lockSettings`.
- **SQL** (two tenants): only the owner calls `staff_*` and `shop_set_lock_settings`, never across shops; cashier and
  manager refused; Starter refused `pin_lock_enabled` (`feature_not_in_plan`); owner without PIN refused
  (`pin_not_set`); owner row protected; member limit enforced; `staff` hashes absent from a non-owner snapshot; sync
  stores valid operator/approver ids and nulls plus an audit row for invalid ones, and never rejects the record.
- **Browser:** lock, unlock and Switch; idle lock; a cashier refund approved by a manager PIN with the approver saved;
  an offline unlock and sale that later syncs with the right operator; Settings → Staff invite, role change, disable,
  reset PIN.

## 9. Out of scope

Per-person permissions; ownership transfer; PINs longer than 4 digits; biometric unlock; staff reports (2H adds
sales by staff); shift scheduling and time clock; manager approval for price overrides beyond the listed actions.

## 10. Open items

- The keyboard shortcut for Switch (pick one not used by the POS).
- Whether "last used a till" needs its own column or can be read from the latest operator record.
