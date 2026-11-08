# Stage 2A: Staff roles and cashier PINs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner-signed-in tills lock behind per-person 4-digit PINs; every record names the person behind the PIN and any approving manager; the owner manages staff in Settings → Staff.

**Architecture:** Three SQL migrations add staff/lock fields, owner-scoped staff functions (sharing internals with the 1I admin functions) and operator/approver columns that the sync RPCs fill in or null-and-audit. On the client, pure modules in `lib/staff/` (PIN hashing, lockout, approval rule, operator session) feed a lock screen, an approval dialog and a Settings → Staff tab; store actions take an optional actor and put it into outbox payloads.

**Tech Stack:** Next.js 16 app router (read `node_modules/next/dist/docs/` before route/UI code, per AGENTS.md), TypeScript, Supabase Postgres + RLS, Web Crypto PBKDF2, `node --test` unit tests, `npm run test:sql` SQL tests.

**Spec:** `docs/superpowers/specs/2026-11-08-stage-2a-staff-and-pins-design.md`

## Global Constraints

- PINs are exactly 4 digits. Hash: PBKDF2-SHA256, 100,000 iterations, random 16-byte salt, 32-byte output, both base64. The server never receives a PIN.
- `idle_lock_minutes` 1–60, default 5. `manager_discount_pct` 0–100, default 10. `pin_lock_enabled` default false.
- Five wrong PINs block that person on that till for 5 minutes; the count is per till and clears on success.
- PIN lock and approvals require entitlement feature `staff_roles` (Pro). Starter behaviour is unchanged.
- Sync never rejects a record because of operator/approver checks: invalid ids are stored as null plus an `audit_events` row `action='sync.operator_unverified'`.
- The `staff` list with hashes is sent only to owner sessions.
- Refusal codes: `pin_not_set`, `member_disabled`, `owner_protected`, `plan_limit_reached`, `feature_not_in_plan`, `not_owner`.
- Switch keyboard shortcut: `F9` (unused today; POS uses `/`, `F2`, `F3`, `Escape`).
- With PIN lock off, the till sends no operator fields and behaves exactly as today.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **Tab reload mid-shift** — the operator lives in session storage; a reload must show the lock screen, never silently continue as the last person or as the owner. Test in Task 7.
- **Staff list changes while a till is unlocked** (person disabled or PIN reset on another device, then snapshot refresh) — the till must drop that operator to the lock screen at the next snapshot. Test in Task 7.
- **Discount percentage at the boundary** — exactly `managerDiscountPct` must NOT need approval; above it must; a 0% setting means any discount needs approval. Test in Task 5.
- **Approver is the same cashier / approver without a PIN / disabled approver** — the approval dialog lists only active managers and the owner who have a PIN. Test in Task 5 (`approverChoices`).
- **Owner turning PIN lock on with no staff PINs yet** — allowed once the owner has a PIN; the lock screen then shows only the owner tile, so the owner is never locked out. Test in Task 2 (SQL) and Task 9 (UI check).

---

### Task 1: Staff and lock fields, operator columns (migration)

**Files:**
- Create: `supabase/migrations/202611080044_staff_pins.sql`
- Create: `supabase/tests/staff_pins_test.sql`

**Interfaces:**
- Produces: columns `business_members.display_name text`, `pin_hash text`, `pin_salt text`, `pin_set_at timestamptz`; `businesses.pin_lock_enabled boolean not null default false`, `idle_lock_minutes smallint not null default 5 check (idle_lock_minutes between 1 and 60)`, `manager_discount_pct smallint not null default 10 check (manager_discount_pct between 0 and 100)`; `operator_member_id uuid` and `approved_by_member_id uuid` (FK `business_members(id)`, nullable) on `sales`, `credit_notes`, `cash_movements`, `stock_movements`; on `register_sessions`: `opened_operator_member_id`, `opened_approved_by_member_id`, `closed_operator_member_id`, `closed_approved_by_member_id`.

- [ ] **Step 1: Write the failing SQL test** `supabase/tests/staff_pins_test.sql` in the style of `foundation_test.sql` (one transaction, `rollback` at the end). Assert: a new business has `pin_lock_enabled = false`, `idle_lock_minutes = 5`, `manager_discount_pct = 10`; updating `idle_lock_minutes` to 0 or 61 raises check_violation; `manager_discount_pct` 101 raises; the new nullable columns exist on all five tables (query `information_schema.columns`); an existing member row has `pin_hash is null`.
- [ ] **Step 2: Run it** — `npm run test:sql -- supabase/tests/staff_pins_test.sql` → FAIL (column does not exist).
- [ ] **Step 3: Write the migration.** Backfill `display_name` from the member's email local part (`split_part(u.email, '@', 1)` joined via `auth.users`).
- [ ] **Step 4: Apply and rerun** — apply to the test project as earlier stages did, then `npm run test:sql -- supabase/tests/staff_pins_test.sql` → PASS; `npm run test:sql` → all PASS.
- [ ] **Step 5: Commit** — `feat(staff): PIN, lock-setting and operator columns (SQL)`.

### Task 2: Owner staff functions sharing the admin internals

**Files:**
- Create: `supabase/migrations/202611080045_staff_functions.sql`
- Modify (by `create or replace` in the new migration, not editing old files): `admin_add_member`, `admin_set_member_role`, `admin_set_member_status` from `202610290041_admin_members.sql`
- Test: `supabase/tests/staff_pins_test.sql` (extend)

**Interfaces:**
- Consumes: Task 1 columns; `has_role`, `owns_business`, `enforce_plan_limit`, `entitlements_internal`.
- Produces (all `security definer`, `set search_path = public`, granted to `authenticated`, each checks `owns_business(p_business_id)` for `auth.uid()` else raises `not_owner`, each writes `audit_events` with `action='staff.<x>'`, actor `auth.uid()`, summary `{before, after}`):
  - `staff_add_member(p_business_id uuid, p_user_id uuid, p_role member_role, p_display_name text) returns uuid` (member id)
  - `staff_set_role(p_business_id uuid, p_member_id uuid, p_role member_role) returns void`
  - `staff_set_status(p_business_id uuid, p_member_id uuid, p_status text) returns void`
  - `staff_reset_pin(p_business_id uuid, p_member_id uuid) returns void`
  - `staff_set_pin(p_business_id uuid, p_member_id uuid, p_pin_hash text, p_pin_salt text) returns void` — allowed for the owner (any member of the shop) or the member themself (`business_members.user_id = auth.uid()`); validates hash/salt are non-empty base64 of 44 and 24 characters; raises `member_disabled` for a disabled member.
  - `shop_set_lock_settings(p_business_id uuid, p_pin_lock_enabled boolean, p_idle_lock_minutes int, p_manager_discount_pct int) returns void` — raises `feature_not_in_plan` when enabling without `staff_roles`, `pin_not_set` when enabling and the owner's member row has no `pin_hash`.
  - Internal (revoked from public): `member_add_internal`, `member_set_role_internal`, `member_set_status_internal` holding today's admin rule bodies (owner row refused with `owner_protected`, one active shop per person, member limit). `admin_*` and `staff_*` both call them.

- [ ] **Step 1: Write failing SQL tests** (two tenants A and B, owners and a cashier of A): owner A adds a manager (row exists, audit row `staff.add_member`); owner B calling any `staff_*` on A raises `not_owner`; cashier A raises `not_owner`; `staff_set_role` / `staff_set_status` on A's owner row raise `owner_protected`; adding past the plan's member limit raises `plan_limit_reached`; `staff_set_pin` by the member themself succeeds and by another cashier raises `not_owner`; `staff_reset_pin` nulls hash/salt/set_at; `staff_set_pin` on a disabled member raises `member_disabled`; `shop_set_lock_settings(true, …)` on a Starter shop raises `feature_not_in_plan`; on a Pro trial shop whose owner has no PIN raises `pin_not_set`; after the owner sets a PIN it succeeds even with no other staff PINs; the existing 1I admin member tests in `foundation_test.sql` still pass.
- [ ] **Step 2: Run** `npm run test:sql` → new assertions FAIL.
- [ ] **Step 3: Write the migration** (extract internals, redefine `admin_*` to call them with `p_actor`, add `staff_*` and `shop_set_lock_settings`).
- [ ] **Step 4: Apply and run** `npm run test:sql` → all PASS.
- [ ] **Step 5: Commit** — `feat(staff): owner staff functions sharing admin member rules (SQL)`.

### Task 3: Sync RPCs record operator and approver

**Files:**
- Create: `supabase/migrations/202611080046_sync_operator.sql`
- Test: `supabase/tests/staff_pins_test.sql` (extend)

**Interfaces:**
- Consumes: Task 1 columns.
- Produces:
  - `verified_member(p_business_id uuid, p_member_id uuid, p_min_role member_role) returns uuid` — returns the id if the member belongs to the business, is `active` and has `role_rank >= role_rank(p_min_role)`; else null.
  - `log_operator_unverified(p_business_id uuid, p_entity_type text, p_entity_id uuid, p_field text, p_member_id uuid) returns void` — inserts `audit_events` `action='sync.operator_unverified'`, summary `{field, memberId}`.
  - Redefined (copy the latest definitions: `apply_sale_sync` from `202610190024_register_access_gate.sql`, `apply_credit_note_sync` and `apply_register_sync` from `202610130016_tills_and_sync_device.sql`, `apply_stock_sync` from `202610180020_catalogue_sync.sql`) to read optional `operatorMemberId` / `approvedByMemberId` from the record object in the payload (`sale`, `creditNote`, `movement`, register `session` / cash adjustment), store `verified_member(...)` results (`cashier` minimum for operator, `manager` for approver), and call `log_operator_unverified` when a non-null id fails verification. Register open writes the `opened_*` pair, close writes `closed_*`.

- [ ] **Step 1: Write failing SQL tests:** a sale payload with a valid cashier operator stores it; with a disabled member stores null and writes one `sync.operator_unverified` row; with an approver who is a cashier stores null approver and logs; with a member of business B stores null and logs; a payload with neither field stores nulls and logs nothing; in every case the sale row exists (never rejected). Repeat the valid/invalid pair for credit note, register open/close and stock movement.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Apply and run** `npm run test:sql` → all PASS.
- [ ] **Step 5: Commit** — `feat(staff): sync records operator and approver, never rejects (SQL)`.

### Task 4: PIN hashing and lockout (pure)

**Files:**
- Create: `lib/staff/pin.ts`, `lib/staff/lockout.ts`
- Test: `tests/staff-pin.test.mjs`

**Interfaces:**
- Produces:
  - `isValidPin(pin: string): boolean` — `/^\d{4}$/`.
  - `hashPin(pin: string, saltB64?: string): Promise<{ hash: string; salt: string }>` — Web Crypto (`globalThis.crypto.subtle`), constants per Global Constraints; new random salt when omitted.
  - `verifyPin(pin: string, hash: string, salt: string): Promise<boolean>` — constant-time compare of decoded bytes.
  - `type LockoutState = Record<string, { fails: number; blockedUntil: number | null }>`
  - `recordFailure(state: LockoutState, memberId: string, now: number): LockoutState` — fifth failure sets `blockedUntil = now + 5 * 60_000` and resets `fails` to 0.
  - `recordSuccess(state: LockoutState, memberId: string): LockoutState`
  - `blockedFor(state: LockoutState, memberId: string, now: number): number` — ms remaining, 0 when free.

- [ ] **Step 1: Write failing tests:** `hashPin("1234", fixedSalt)` equals a fixed expected hash (compute once with Node `crypto.pbkdf2Sync("1234", Buffer.from(salt,'base64'), 100000, 32, 'sha256')` and paste); `verifyPin` true for the right PIN, false for `"1235"`; `isValidPin` rejects `"123"`, `"12345"`, `"12a4"`, `" 1234"`; two `hashPin("1234")` calls give different salts; four failures leave `blockedFor` 0, the fifth gives 300000; at `now + 300000` it is 0; `recordSuccess` clears the count.
- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/staff-pin.test.mjs` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(staff): PIN hashing and five-try lockout`.

### Task 5: Approval rule and role page access (pure)

**Files:**
- Create: `lib/staff/approval.ts`
- Modify: `lib/access/cashier.ts` (manager rights)
- Test: `tests/staff-approval.test.mjs`, `tests/cashier-access.test.mjs` (extend)

**Interfaces:**
- Produces:
  - `type ApprovalAction = { kind: "refund" } | { kind: "remove-line" } | { kind: "lower-quantity" } | { kind: "register-open" } | { kind: "register-close" } | { kind: "discount"; discountFils: number; listTotalFils: number }`
  - `needsApproval(action: ApprovalAction, operatorRole: MemberRole, managerDiscountPct: number): boolean` — false for manager/owner; for cashier: true for all kinds except discount, where true iff `discountFils * 100 > managerDiscountPct * listTotalFils` (exact boundary does not need approval; pct 0 means any discount > 0 does).
  - `type StaffMember = { memberId: string; displayName: string; role: MemberRole; status: "active" | "disabled"; pinHash: string | null; pinSalt: string | null }`
  - `approverChoices(staff: StaffMember[], operatorId: string): StaffMember[]` — active, role manager or owner, with a PIN, excluding `operatorId`.
  - `canUsePage(role, pathname, tab)` keeps its signature; manager gains `/inventory` editing (new export `canEditCatalogue(role: Role): boolean` true for manager and owner).

- [ ] **Step 1: Write failing tests** for every action kind × role; discount at 10% with pct 10 → false, 10.01% → true, pct 0 with 1 fils discount → true; `approverChoices` drops the operator, cashiers, disabled and PIN-less members; `canEditCatalogue("manager")` true, `("cashier")` false; existing cashier-access tests still pass.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** — `feat(staff): manager approval rule and manager catalogue rights`.

### Task 6: Snapshot carries lock settings and the owner-only staff list

**Files:**
- Modify: `app/api/v1/snapshot/route.ts`, `lib/snapshot/types.ts`, `lib/snapshot/map-rows.ts`
- Test: `tests/snapshot-map.test.mjs` (extend)

**Interfaces:**
- Consumes: `StaffMember` (Task 5).
- Produces: `ShopSnapshot` gains `lockSettings: { pinLockEnabled: boolean; idleLockMinutes: number; managerDiscountPct: number }` and `staff: StaffMember[]`. `SnapshotRows` gains `lock: { pin_lock_enabled: boolean; idle_lock_minutes: number; manager_discount_pct: number }` and `staff: { id: string; display_name: string; role: string; status: string; pin_hash: string | null; pin_salt: string | null }[]`. The route selects staff only when `membership.role === "owner"` (else `[]`), and maps `pinLockEnabled` to false when entitlements lack `staff_roles`.

- [ ] **Step 1: Write failing tests:** `mapSnapshotRows` maps `lock` and `staff` (snake → camel); unknown role/status values map to `cashier` / `disabled`; missing `lock` (old server) maps to `{ pinLockEnabled: false, idleLockMinutes: 5, managerDiscountPct: 10 }` and `staff: []`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** types, mapper and route (read the route-handler docs in `node_modules/next/dist/docs/01-app/` first).
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** — `feat(staff): snapshot lock settings and owner-only staff list`.

### Task 7: Operator session and actor on store actions

**Files:**
- Create: `lib/staff/operator-session.ts`
- Modify: `lib/domain.ts`, `lib/demo-store.ts`
- Test: `tests/staff-operator.test.mjs`

**Interfaces:**
- Consumes: `StaffMember`, `lockSettings` (Task 6).
- Produces:
  - `type Actor = { operatorMemberId: string; approvedByMemberId?: string }`
  - Domain: `Sale`, `CreditNote`, `StockMovement`, `CashAdjustment` gain optional `operatorMemberId?: string; approvedByMemberId?: string`; `RegisterSession` gains optional `openedOperatorMemberId`, `openedApprovedByMemberId`, `closedOperatorMemberId`, `closedApprovedByMemberId`.
  - Store: `completeSale(lines, method, customerId?, actor?: Actor)`, `createCreditNote(saleId, quantities, found?, actor?: Actor)`, `openRegister(cash, actor?: Actor)`, `closeRegister(counted, actor?: Actor)`, `addCashAdjustment(amount, reason, actor?: Actor)`, `adjustStock(productId, delta, reason, actor?: Actor)` copy the actor onto the record so it travels in the outbox payload. Without an actor, nothing changes.
  - `operator-session.ts`: `getOperator(): StaffMember | null`, `setOperator(m: StaffMember | null): void`, `subscribeOperator(fn: () => void): () => void`, `reconcileOperator(staff: StaffMember[]): void` (clears the operator when they are no longer active or their `pinHash` changed), storage key `billo.operator` in `sessionStorage` holding only `memberId` + `pinHash`; `restoreOperator(staff)` returns the stored member only if still active with the same `pinHash`.

- [ ] **Step 1: Write failing tests** (pure parts, injected storage): `restoreOperator` returns null after the member is disabled or their PIN reset; `reconcileOperator` clears a disabled operator; a reloaded tab with no stored operator returns null; the sale record built with an actor carries both ids (test the record builder used by `completeSale`, extracted as `withActor<T>(record: T, actor?: Actor): T`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** — `feat(staff): operator session and actor on till records`.

### Task 8: Staff API routes and parsers

**Files:**
- Create: `lib/staff/actions.ts`, `lib/staff/invite.ts`, `app/api/v1/staff/route.ts` (POST invite), `app/api/v1/staff/[memberId]/route.ts` (PATCH role/status), `app/api/v1/staff/[memberId]/pin/route.ts` (PUT set, DELETE reset), `app/api/v1/staff/[memberId]/invite/route.ts` (POST resend), `app/api/v1/staff/settings/route.ts` (PUT lock settings)
- Test: `tests/staff-actions.test.mjs`

**Interfaces:**
- Consumes: Task 2 SQL functions; `lib/admin/members.ts` invite pattern (lookup via `admin_member_lookup` with the service-role client, invite with `inviteUserByEmail`).
- Produces:
  - Parsers returning `{ ok: true, … } | { ok: false; code: string }`: `parseInvite(body): { email: string; displayName: string; role: "cashier" | "manager" }`, `parseRole(body)`, `parseStatus(body)`, `parsePinSet(body): { pinHash: string; pinSalt: string }` (base64 lengths 44/24), `parseLockSettings(body): { pinLockEnabled: boolean; idleLockMinutes: number; managerDiscountPct: number }`.
  - `staffErrorMessage(code: string): string` — plain sentences for each refusal code in Global Constraints.
  - `inviteStaff(userClient, adminClient, input, deps)` — verifies `owns_business` with the user client first, then lookup/invite with the admin client, then `staff_add_member` with the user client (so `auth.uid()` is the owner). Returns `{ ok: true; memberId: string; invited: boolean } | { ok: false; code: string }`.

- [ ] **Step 1: Write failing tests:** each parser accepts good input and rejects bad (email without `@`, role `owner`, idle 0/61, pct 101, PIN hash wrong length); `inviteStaff` with fakes: non-owner stops before any admin call (`not_owner`); invite error stops before `staff_add_member`; existing account skips invite; P0001 `plan_limit_reached` surfaces as that code.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** parsers, `inviteStaff`, and the routes (read the route-handler docs first; follow `app/api/v1/admin/shops/[id]/members/route.ts` for shape, but authenticate with the user session, not `requireStaff`).
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint` → PASS.
- [ ] **Step 5: Commit** — `feat(staff): owner staff API routes`.

### Task 9: Lock screen, PIN pad, Switch and idle lock

**Files:**
- Create: `components/staff/lock-screen.tsx`, `components/staff/pin-pad.tsx`, `components/staff/operator-chip.tsx`, `hooks/use-idle-lock.ts`
- Modify: `components/app-shell.tsx` (mount lock screen and chip when the snapshot says `pinLockEnabled` and the session role is owner), app CSS in `app/globals.css`
- Test: `tests/staff-idle.test.mjs`

**Interfaces:**
- Consumes: Tasks 4, 6, 7.
- Produces: `shouldLock(lastActivityMs: number, nowMs: number, idleLockMinutes: number): boolean` exported from `hooks/use-idle-lock.ts` (pure part); `<PinPad onSubmit={(pin) => Promise<boolean>} blockedMs={number} />` reused by Task 10 and Task 11.

- [ ] **Step 1: Write failing test** for `shouldLock`: false at 4:59 with 5 minutes, true at 5:00.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** the hook (pointer, touch and key events reset activity; `F9` and the Switch button call `setOperator(null)`), the lock screen (tiles for active members with a PIN; "PIN not set" tiles disabled; only the owner tile when no staff have PINs), the PIN pad (4 dots, digit keys and keyboard digits, Backspace, shake on wrong, "Try again in m:ss" while blocked, lockout state kept in `localStorage` key `billo.pinLockout`), and the header chip "Name · Role" with Switch. Pages follow the operator's role via `canUsePage(operator.role, …)`.
- [ ] **Step 4: Run** `npm test`, typecheck, lint → PASS. Browser check on the dev server (`.claude/launch.json` "dev"): enable the lock on a Pro test shop, unlock as owner, Switch with F9, idle-lock after the minimum (set 1 minute), five wrong PINs then the block message, reload the tab → lock screen.
- [ ] **Step 5: Commit** — `feat(staff): till lock screen, PIN pad, Switch and idle lock`.

### Task 10: Manager approval at the till

**Files:**
- Create: `components/staff/approval-dialog.tsx`
- Modify: `components/pos-workspace.tsx` (remove line, lower quantity, discount check before payment), `components/invoice-detail-workspace.tsx` (credit note), `components/register-workspace.tsx` (open/close)

**Interfaces:**
- Consumes: `needsApproval`, `approverChoices` (Task 5); `PinPad` (Task 9); `Actor` and store signatures (Task 7).
- Produces: hook `useApproval()` returning `requestApproval(action: ApprovalAction): Promise<string | null | undefined>` — `undefined` when no approval is needed, `null` when cancelled, the approver's member id when approved.

- [ ] **Step 1: Wire each action:** when `needsApproval` is true, open the dialog listing `approverChoices`; on approval pass `{ operatorMemberId, approvedByMemberId }` to the store call; on cancel leave state unchanged (the line stays, the quantity stays, the payment dialog stays open). For discounts, check at Pay using cart totals (`discountFils`, list total) before `completeSale`.
- [ ] **Step 2: Run** `npm test`, typecheck, lint → PASS.
- [ ] **Step 3: Browser check:** as a cashier, remove a line → dialog → cancel keeps the line → approve with the manager PIN removes it; a 15% discount at Pay asks for approval and the synced sale has `approved_by_member_id` = the manager (check via the sales detail or SQL); a refund and a register close each ask and record the approver; as a manager none of these ask.
- [ ] **Step 4: Commit** — `feat(staff): manager approval for refunds, discounts, removals and register`.

### Task 11: Settings → Staff

**Files:**
- Create: `components/staff/staff-tab.tsx`, `components/staff/invite-form.tsx`, `components/staff/set-pin-dialog.tsx`, `components/staff/your-pin-card.tsx`, `components/staff/lock-settings-form.tsx`
- Modify: `app/(dashboard)/settings/page.tsx` (owner tab `{ tab: "staff", label: "Staff" }` after "Tills"; "Your PIN" card on the member Data view)

**Interfaces:**
- Consumes: Task 8 routes and `staffErrorMessage`; `hashPin`, `isValidPin` (Task 4); `PinPad` (Task 9); `FeatureGate` for Starter.

- [ ] **Step 1: Build** the staff list (name, email, role, Active/Disabled, PIN set / "PIN not set", last used a till from the latest operator record), row actions (role, disable/enable, reset PIN, resend invite, set PIN at this till) using the existing confirm dialog for disable and reset; invite form (at the member limit show "Your plan allows N users" and an upgrade link instead of Send); Your PIN card and Set PIN dialog (enter twice, hash on device, PUT); lock settings form (switch, 1–60 minutes, 0–100 %) behind `FeatureGate` for `staff_roles`. After every change call `refreshSnapshot()`.
- [ ] **Step 2: Run** `npm test`, typecheck, lint → PASS.
- [ ] **Step 3: Browser check:** invite a cashier and a manager (test project), change a role, disable and re-enable, reset a PIN (the till drops that person at the next snapshot), set a PIN at this till, set Your PIN, turn the lock on with only the owner PIN (lock screen shows only the owner tile), Starter shop shows the Pro prompt.
- [ ] **Step 4: Commit** — `feat(staff): Settings → Staff tab`.

### Task 12: End-to-end check, ledger and release notes

**Files:**
- Create: `docs/superpowers/plans/2026-11-08-stage-2a-ledger.md`
- Modify: `docs/RELEASE_CHECKLIST.md` (2A section)

- [ ] **Step 1: Offline browser run** on a production build (`npm run build` then `npm start`; dev mode is not a reliable offline demo): unlock as a cashier, go offline, sell, Switch to a manager, approve a refund, go online, sync; confirm in SQL that the sale's `operator_member_id` is the cashier and the credit note's `approved_by_member_id` the manager, and no `sync.operator_unverified` rows; then disable the cashier on another device, sell offline on the first till as that cashier, sync, confirm the sale exists with null operator and one `sync.operator_unverified` row.
- [ ] **Step 2: Full suite** — `npm test`, `npm run test:sql`, `npm run typecheck`, `npm run lint` → all PASS.
- [ ] **Step 3: Write the ledger** (decisions taken during the build, deferred minors) and the release checklist section (migrations 044–046 in order; enabling the lock is per shop by the owner).
- [ ] **Step 4: Commit** — `docs: Stage 2A ledger and release notes`.
