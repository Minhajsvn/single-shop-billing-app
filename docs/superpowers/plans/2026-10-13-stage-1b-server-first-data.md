# Stage 1B: Server-First Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed-in shops read and write their real Supabase data, never demo data. Each browser acts as a known till with its own invoice series, and the client can read its plan entitlements, including offline.

**Architecture:**
- **Store API stays the same.** The existing `useDemoStore()` hook and its action functions keep their names and shapes, so screens change little. Underneath, the store gains two modes:
  - **hosted:** loads a server snapshot (`GET /api/v1/snapshot`), cached in IndexedDB.
  - **sample:** today's demo data, only when explicitly chosen.
- **Writes are unchanged:** optimistic local update, then outbox, then `POST /api/v1/sync`. A successful sync triggers a snapshot refresh, and a pure merge function keeps not-yet-synced local changes on top of server data.
- **Tills are explicit.** Each device gets a `till_number`; every sync payload carries `deviceId`. The RPCs book work to that till instead of to "the first active device". Invoice numbers include the till: `PREFIX-<till>-YYMMDD-NNNN`.

**Tech Stack:** Next.js 16 route handlers, React 19 `useSyncExternalStore`, Supabase (Postgres RPCs, RLS), zod 4, Node 24 test runner, `node:crypto` HMAC.

**Spec:** `docs/superpowers/specs/2026-10-11-saas-plans-and-improvements-design.md` (§3.2 entitlements, §4 Critical #1, §5 Stage 1 item 3)
**Builds on:** sub-plan 1A, merged at `28b54c6`. Read its ledger, `docs/superpowers/plans/2026-10-11-stage-1a-ledger.md`, for deferred items. This plan closes these from it:
- Entitlements TS type
- fail-closed `business_entitlements`
- main-branch/business drift
- setup must validate enabled countries

## Global Constraints

- Money is integer minor units. Existing `*_fils` names are kept.
- Every business table enforces RLS. Server secrets never enter the browser bundle; `ENTITLEMENT_SIGNING_SECRET` is server-only.
- Completed invoices and credit notes are immutable. No billing state may block, alter or delete an issued fiscal document. Sync never rejects an already-issued invoice because of entitlements.
- Only `AE` is enabled in Stage 1.
- **Invoice numbers:** `${invoicePrefix}-${tillNumber}-${YYMMDD}-${NNNN}`. **Credit notes:** `CN-${tillNumber}-${YYMMDD}-${NNNN}`. NNNN is a 4-digit, per-till, per-Dubai-day sequence. Never renumber after checkout.
- Business dates use `Asia/Dubai`.
- The offline entitlement snapshot is valid for **72 hours**.
- **Signed-in (hosted) shops never see seeded demo data.** Sample data appears only after an explicit "Try sample shop" choice, and is labelled on every page.
- Code imported by `node --test` uses relative imports **with `.ts` extensions**, not `@/`.
- Before writing Next.js route or page code, read the relevant guide in `node_modules/next/dist/docs/` (per `AGENTS.md`).
- **Database work runs against LOCAL Supabase only:**
  - prefix PowerShell with `$env:Path = "C:\Users\Administrator\AppData\Local\Programs\DockerDesktop\resources\bin;" + $env:Path`
  - start with `supabase start -x studio,imgproxy,edge-runtime,logflare,vector,mailpit,supavisor,postgres-meta`
  - apply migrations with `supabase db reset`
  - run tests with `npm run test:sql` and `npm run test:rehearsal`
  - **never** push to the hosted project

## Review Focus

1. **Offline sale, then reconnect, then snapshot refresh.** A sale made offline must stay visible after a refresh that ran before its sync was accepted; it must not vanish or duplicate. Covered by Task 5 (merge tests).
2. **Two tills, same day.** Till 1 and Till 2 each issuing their first invoice of the day must produce different numbers and both sync. Covered by Task 2 (numbering) and Task 1 (SQL: the sale is booked to the payload's device).
3. **A spoofed or foreign `deviceId`.** A sync naming another business's device, or a revoked one, is rejected; old queued ops with no `deviceId` still sync. Covered by Task 1.
4. **Tampered or expired offline entitlement token.** It must be rejected, and the client falls back to read-only. Covered by Task 3.
5. **A signed-in user whose browser still holds old demo data in localStorage.** They must see their server data, never the demo invoices. Covered by Task 6 (the store ignores the legacy demo key in hosted mode).

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/202610130016_tills_and_sync_device.sql` (create) | `devices.till_number`, `sync_device_id()`, sync RPCs use the payload device, fail-closed entitlements, main-branch mirror of business settings |
| `supabase/tests/foundation_test.sql` (modify) | Sections 12–15 for the above |
| `lib/invoice-numbers.ts` (create) | Pure invoice/credit-note number generation and the Dubai date code |
| `lib/billing/entitlements.ts` (create) | `Entitlements` type, zod parser, `hasFeature`, `isReadOnly` |
| `lib/billing/entitlement-token.ts` (create) | HMAC sign/verify of the offline snapshot (server-only) |
| `app/api/v1/entitlements/route.ts` (create) | `GET`: entitlements plus a signed 72h token |
| `lib/snapshot/types.ts` (create) | `BusinessProfile`, `TillDevice`, `ShopSnapshot`, DB row types |
| `lib/snapshot/map-rows.ts` (create) | Pure mapping from DB rows to `ShopSnapshot` |
| `lib/snapshot/merge.ts` (create) | Pure merge of a server snapshot with unsynced local state |
| `app/api/v1/snapshot/route.ts` (create) | `GET ?deviceId=`: loads rows, maps, returns `ShopSnapshot` |
| `lib/device.ts` (create) | This browser's till identity (localStorage) |
| `lib/domain.ts` (modify) | `SupplierSnapshot`, `Sale.supplier` |
| `lib/demo-store.ts` (modify) | hosted/sample modes, snapshot hydrate and refresh, till numbering, `deviceId` in payloads |
| `app/api/v1/sync/route.ts` (modify) | business via membership; `deviceId` passed to RPCs |
| `app/api/v1/business/route.ts` (modify) | business via membership (`has_role`), not `owner_id` |
| `components/business-setup.tsx` (modify) | store the device ID, country fixed to AE, no localStorage settings |
| `components/till-picker.tsx` (create) | "Use this browser as…" when no device is stored |
| `components/auth-gate.tsx` (modify) | business check, then till picker, then start hosted store |
| `components/invoice-detail-workspace.tsx`, `app/(dashboard)/settings/page.tsx`, `app/(dashboard)/overview/page.tsx`, `app/login/page.tsx` (modify) | supplier/business from the store, sample-mode banner, "Try sample shop" |
| `tests/invoice-numbers.test.mjs`, `tests/entitlements.test.mjs`, `tests/snapshot-map.test.mjs`, `tests/snapshot-merge.test.mjs` (create) | Unit tests |

---

### Task 1: Tills and device-aware sync in the database

**Files:**
- Create: `supabase/migrations/202610130016_tills_and_sync_device.sql`
- Modify: `supabase/tests/foundation_test.sql` (append sections 12–15 before the final `rollback;`)

**Interfaces:**
- Consumes (from 1A): `public.devices`, `public.branches` (`is_main`), `public.has_role`, `public.entitlements_internal`, the five sync RPCs in `202609130006`–`202609140009`
- Produces:
  - `devices.till_number smallint not null`, `unique (business_id, till_number)`, assigned automatically on insert (1, 2, …)
  - `public.sync_device_id(p_business_id uuid, p_payload jsonb) returns uuid`:
    - when `p_payload->>'deviceId'` is present, it must be an **active device of that business**; otherwise it raises `sync_device_invalid`
    - when absent, it falls back to the oldest active device (for legacy queued ops)
  - every sync RPC books to `public.sync_device_id(...)`
  - `business_entitlements(uuid)` raises `forbidden` when `auth.uid()` is null
  - updating `businesses.address / invoice_prefix / receipt_footer` mirrors to the main branch

- [ ] **Step 1: Write the failing SQL tests.** Append this to `supabase/tests/foundation_test.sql` before the final `rollback;`. The session is the migration owner at that point, after section 11.

```sql
-- 12. Till numbers: existing and new devices get 1, 2, … per business.
do $$ begin
  assert (select till_number from public.devices where id = 'd0000000-0000-4000-8000-00000000000a') = 1, 'first device is till 1';
  assert (select till_number from public.devices where id = 'd0000000-0000-4000-8000-0000000000a2') = 2, 'second device is till 2';
end $$;

-- 13. sync_device_id: payload device must belong to the business and be active; absent falls back.
do $$
declare
  a constant uuid := 'b0000000-0000-4000-8000-00000000000a';
  b constant uuid := 'b0000000-0000-4000-8000-00000000000b';
begin
  assert public.sync_device_id(a, '{"deviceId":"d0000000-0000-4000-8000-0000000000a2"}'::jsonb) = 'd0000000-0000-4000-8000-0000000000a2', 'explicit device used';
  assert public.sync_device_id(a, '{}'::jsonb) = 'd0000000-0000-4000-8000-00000000000a', 'absent deviceId falls back to oldest active';
  begin
    perform public.sync_device_id(b, '{"deviceId":"d0000000-0000-4000-8000-00000000000a"}'::jsonb);
    assert false, 'foreign device must be rejected';
  exception when others then
    assert sqlerrm = 'sync_device_invalid', format('expected sync_device_invalid, got %s', sqlerrm);
  end;
  update public.devices set status = 'revoked' where id = 'd0000000-0000-4000-8000-0000000000a2';
  begin
    perform public.sync_device_id(a, '{"deviceId":"d0000000-0000-4000-8000-0000000000a2"}'::jsonb);
    assert false, 'revoked device must be rejected';
  exception when others then
    assert sqlerrm = 'sync_device_invalid', format('expected sync_device_invalid, got %s', sqlerrm);
  end;
  update public.devices set status = 'active' where id = 'd0000000-0000-4000-8000-0000000000a2';
  assert not exists (
    select 1 from pg_proc p
    where p.proname in ('apply_customer_sync','apply_sale_sync','apply_register_sync','apply_credit_note_sync','apply_stock_sync')
      and p.prosrc ~ 'order by (d\.)?created_at'
  ), 'no sync RPC still picks the oldest device itself';
end $$;

-- 14. business_entitlements fails closed without a user.
do $$ begin
  begin
    perform public.business_entitlements('b0000000-0000-4000-8000-00000000000a');
    assert false, 'no auth.uid() must be forbidden';
  exception when others then
    assert sqlerrm = 'forbidden', format('expected forbidden, got %s', sqlerrm);
  end;
end $$;

-- 15. Business settings mirror to the main branch.
update public.businesses set address = 'Mirror Street', invoice_prefix = 'MIR', receipt_footer = 'Mirrored' where id = 'b0000000-0000-4000-8000-00000000000b';
do $$ begin
  assert (select address = 'Mirror Street' and invoice_prefix = 'MIR' and receipt_footer = 'Mirrored'
          from public.branches where business_id = 'b0000000-0000-4000-8000-00000000000b' and is_main), 'main branch mirrors business settings';
end $$;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:sql`
Expected: FAIL with `column "till_number" does not exist`.

- [ ] **Step 3: Write the migration.** Create `supabase/migrations/202610130016_tills_and_sync_device.sql` in four parts, in this order.

**Part A: till numbers and device resolver**

```sql
-- Stage 1B: explicit tills. Each device has a per-business till number, and sync work is booked to the device named in the payload.

alter table public.devices add column till_number smallint;

update public.devices d
set till_number = numbered.n
from (select id, row_number() over (partition by business_id order by created_at, id) as n from public.devices) numbered
where numbered.id = d.id;

alter table public.devices alter column till_number set not null;
alter table public.devices add constraint devices_till_number_positive check (till_number between 1 and 999);
alter table public.devices add constraint devices_business_till_unique unique (business_id, till_number);

create function public.assign_till_number()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.till_number is null then
    perform pg_advisory_xact_lock(hashtextextended(new.business_id::text || ':till_number', 0));
    new.till_number := coalesce((select max(till_number) from public.devices where business_id = new.business_id), 0) + 1;
  end if;
  return new;
end
$$;

create trigger assign_till_number before insert on public.devices for each row execute function public.assign_till_number();

create function public.sync_device_id(p_business_id uuid, p_payload jsonb)
returns uuid language plpgsql stable security definer set search_path = public
as $$
declare
  requested text := nullif(p_payload->>'deviceId', '');
  resolved uuid;
begin
  if requested is not null then
    select d.id into resolved from public.devices d
    where d.id::text = requested and d.business_id = p_business_id and d.status = 'active';
    if resolved is null then
      raise exception using errcode = 'P0001', message = 'sync_device_invalid';
    end if;
    return resolved;
  end if;
  select d.id into resolved from public.devices d
  where d.business_id = p_business_id and d.status = 'active'
  order by d.created_at, d.id
  limit 1;
  return resolved;
end
$$;

revoke execute on function public.sync_device_id(uuid, jsonb) from public, anon, authenticated;
```

**Part B: redefine the five sync RPCs.** Copy each function definition **verbatim**, from its `create or replace function` line through its closing `$$;` plus any trailing `grant`/`revoke` lines for that function, into this migration:
- `apply_customer_sync` from `202609130006`
- `apply_sale_sync` from `202609130007`
- `apply_register_sync` and `apply_credit_note_sync` from `202609130008`
- `apply_stock_sync` from `202609140009`

Then make ONLY these textual replacements inside the copies:
1. In `apply_sale_sync`, `apply_register_sync`, `apply_credit_note_sync` and `apply_stock_sync`, replace the whole block

```sql
  select d.id
  into active_device_id
  from public.devices d
  where d.business_id = p_business_id and d.status = 'active'
  order by d.created_at
  limit 1;
```
   with
```sql
  active_device_id := public.sync_device_id(p_business_id, p_payload);
```
   Indentation in the copies may differ; match the statement, not the whitespace. Keep the following `if active_device_id is null then raise exception 'no_active_device'` lines unchanged.
2. In `apply_customer_sync`, replace the inline subquery `(select id from public.devices where business_id = p_business_id and status = 'active' order by created_at limit 1)` with `public.sync_device_id(p_business_id, p_payload)`.
3. In every copied header, keep `set search_path = public, pg_temp`, then add right after the copies:

```sql
alter function public.apply_customer_sync(uuid, uuid, uuid, jsonb) set search_path = public, extensions, pg_temp;
alter function public.apply_sale_sync(uuid, uuid, uuid, jsonb) set search_path = public, extensions, pg_temp;
alter function public.apply_register_sync(uuid, uuid, uuid, jsonb) set search_path = public, extensions, pg_temp;
alter function public.apply_credit_note_sync(uuid, uuid, uuid, jsonb) set search_path = public, extensions, pg_temp;
alter function public.apply_stock_sync(uuid, uuid, uuid, jsonb) set search_path = public, extensions, pg_temp;
```
   This re-applies the `202610100001` hotfix, which `create or replace` would otherwise undo. Section 11 of the SQL tests guards it.

**Part C: fail-closed entitlements**

```sql
create or replace function public.business_entitlements(target_business_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null or not public.has_role(target_business_id, 'cashier') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  return public.entitlements_internal(target_business_id, now());
end
$$;
```

**Part D: main branch mirrors business settings**

```sql
create function public.mirror_business_to_main_branch()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if (new.address, new.invoice_prefix, new.receipt_footer) is distinct from (old.address, old.invoice_prefix, old.receipt_footer) then
    update public.branches
    set address = new.address, invoice_prefix = new.invoice_prefix, receipt_footer = new.receipt_footer
    where business_id = new.id and is_main;
  end if;
  return new;
end
$$;

create trigger mirror_business_to_main_branch after update on public.businesses for each row execute function public.mirror_business_to_main_branch();
```

- [ ] **Step 4: Apply and run all database tests**

Run: `supabase db reset`, then `npm run test:sql`, then `npm run test:rehearsal`.
Expected:
- `PASS supabase/tests/foundation_test.sql`
- rehearsal `PASS`: existing devices get till numbers 1 and 2 via the backfill. Add one assertion to `supabase/tests/rehearsal/assert_after_migrations.sql`: business 1's two devices have till numbers 1 and 2.
- `npm test` passes, with no TS changes in this task.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202610130016_tills_and_sync_device.sql supabase/tests/foundation_test.sql supabase/tests/rehearsal/assert_after_migrations.sql
git commit -m "feat(db): till numbers and device-aware sync RPCs; fail-closed entitlements"
```

---

### Task 2: Per-till invoice and credit-note numbers

**Files:**
- Create: `lib/invoice-numbers.ts`
- Test: `tests/invoice-numbers.test.mjs`

**Interfaces:**
- Produces:
  - `dubaiDateCode(date: Date): string` (`YYMMDD`)
  - `dubaiSupplyDate(date: Date): string` (`YYYY-MM-DD`)
  - `nextInvoiceNumber(prefix: string, tillNumber: number, date: Date, existing: string[]): string`
  - `nextCreditNoteNumber(tillNumber: number, date: Date, existing: string[]): string`

- [ ] **Step 1: Write the failing test** in `tests/invoice-numbers.test.mjs`

```js
import assert from "node:assert/strict";
import test from "node:test";
import { dubaiDateCode, dubaiSupplyDate, nextCreditNoteNumber, nextInvoiceNumber } from "../lib/invoice-numbers.ts";

const at = new Date("2026-10-13T21:30:00Z"); // 01:30 on 14 Oct in Dubai

test("dates use the Dubai business day", () => {
  assert.equal(dubaiDateCode(at), "261014");
  assert.equal(dubaiSupplyDate(at), "2026-10-14");
});

test("each till has its own daily sequence", () => {
  const existing = ["SMK-1-261014-0001", "SMK-1-261014-0002", "SMK-2-261014-0001", "SMK-1-261013-0009"];
  assert.equal(nextInvoiceNumber("SMK", 1, at, existing), "SMK-1-261014-0003");
  assert.equal(nextInvoiceNumber("SMK", 2, at, existing), "SMK-2-261014-0002");
  assert.equal(nextInvoiceNumber("SMK", 3, at, existing), "SMK-3-261014-0001");
});

test("legacy numbers without a till and other prefixes are ignored", () => {
  assert.equal(nextInvoiceNumber("SMK", 1, at, ["SMK-261014-0007", "ABC-1-261014-0004"]), "SMK-1-261014-0001");
});

test("prefixes containing regex characters are matched literally", () => {
  assert.equal(nextInvoiceNumber("A-B", 1, at, ["A-B-1-261014-0001", "AXB-1-261014-0005"]), "A-B-1-261014-0002");
});

test("credit notes follow the same per-till rule", () => {
  assert.equal(nextCreditNoteNumber(2, at, ["CN-2-261014-0001", "CN-1-261014-0004"]), "CN-2-261014-0002");
});

test("till numbers must be positive integers", () => {
  assert.throws(() => nextInvoiceNumber("SMK", 0, at, []), RangeError);
  assert.throws(() => nextCreditNoteNumber(1.5, at, []), RangeError);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --experimental-strip-types --test tests/invoice-numbers.test.mjs`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Create `lib/invoice-numbers.ts`**

```ts
function dubaiParts(date: Date, year: "2-digit" | "numeric") {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", year, month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { year: value("year"), month: value("month"), day: value("day") };
}

export function dubaiDateCode(date: Date): string {
  const { year, month, day } = dubaiParts(date, "2-digit");
  return `${year}${month}${day}`;
}

export function dubaiSupplyDate(date: Date): string {
  const { year, month, day } = dubaiParts(date, "numeric");
  return `${year}-${month}-${day}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nextInSeries(seriesPrefix: string, existing: string[]): string {
  const pattern = new RegExp(`^${escapeRegExp(seriesPrefix)}(\\d{4,})$`);
  const used = existing.map((value) => value.match(pattern)).filter((match): match is RegExpMatchArray => Boolean(match)).map((match) => Number(match[1]));
  return `${seriesPrefix}${String(Math.max(0, ...used) + 1).padStart(4, "0")}`;
}

function assertTill(tillNumber: number) {
  if (!Number.isInteger(tillNumber) || tillNumber < 1) throw new RangeError("Till number must be a positive integer.");
}

export function nextInvoiceNumber(prefix: string, tillNumber: number, date: Date, existing: string[]): string {
  assertTill(tillNumber);
  return nextInSeries(`${prefix}-${tillNumber}-${dubaiDateCode(date)}-`, existing);
}

export function nextCreditNoteNumber(tillNumber: number, date: Date, existing: string[]): string {
  assertTill(tillNumber);
  return nextInSeries(`CN-${tillNumber}-${dubaiDateCode(date)}-`, existing);
}
```

- [ ] **Step 4: Run the tests and the full suite**

Run: `node --experimental-strip-types --test tests/invoice-numbers.test.mjs && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/invoice-numbers.ts tests/invoice-numbers.test.mjs
git commit -m "feat: per-till invoice and credit-note numbering"
```

---

### Task 3: Entitlements type, offline token, and API

**Files:**
- Create: `lib/billing/entitlements.ts`, `lib/billing/entitlement-token.ts`, `app/api/v1/entitlements/route.ts`
- Modify: `.env.example` (add `ENTITLEMENT_SIGNING_SECRET=`)
- Test: `tests/entitlements.test.mjs`

**Interfaces:**
- Consumes: `FeatureKey`, `PlanId` from `lib/billing/plans.ts`; SQL `business_entitlements(uuid)` (Task 1, fail-closed)
- Produces:
  - `type Entitlements = { planId: PlanId | null; status: "trialing" | "active" | "past_due" | "canceled" | null; access: "full" | "read_only"; trialEndsAt: string | null; graceEndsAt: string | null; features: FeatureKey[]; limits: { branches: number | null; tills: number | null; members: number | null; products: number | null } }`
  - `parseEntitlements(input: unknown): Entitlements` (throws on invalid input)
  - `READ_ONLY_ENTITLEMENTS: Entitlements`
  - `hasFeature(e: Entitlements, feature: FeatureKey): boolean`, which is false when `access` is `read_only`
  - `signEntitlements(e: Entitlements, businessId: string, secret: string, now?: Date): { token: string; expiresAt: string }`
  - `verifyEntitlements(token: string, secret: string, now?: Date): { businessId: string; entitlements: Entitlements } | null`
  - `ENTITLEMENT_TOKEN_TTL_HOURS = 72`
  - `GET /api/v1/entitlements` returns `{ businessId, entitlements, token, expiresAt }`

- [ ] **Step 1: Write the failing test** in `tests/entitlements.test.mjs`

```js
import assert from "node:assert/strict";
import test from "node:test";
import { READ_ONLY_ENTITLEMENTS, hasFeature, parseEntitlements } from "../lib/billing/entitlements.ts";
import { ENTITLEMENT_TOKEN_TTL_HOURS, signEntitlements, verifyEntitlements } from "../lib/billing/entitlement-token.ts";

const raw = {
  planId: "pro", status: "trialing", access: "full", trialEndsAt: "2026-10-27T00:00:00+00:00", graceEndsAt: null,
  features: ["serial_tracking", "staff_roles"], limits: { branches: 1, tills: 2, members: 5, products: null },
};
const secret = "test-secret-at-least-32-characters-long!!";
const now = new Date("2026-10-13T10:00:00Z");

test("parses the SQL resolver payload", () => {
  const e = parseEntitlements(raw);
  assert.equal(e.limits.products, null);
  assert.equal(hasFeature(e, "serial_tracking"), true);
  assert.equal(hasFeature(e, "repairs"), false);
});

test("rejects malformed payloads and unknown features", () => {
  assert.throws(() => parseEntitlements({ ...raw, access: "maybe" }));
  assert.throws(() => parseEntitlements({ ...raw, features: ["teleport"] }));
});

test("read-only access disables every feature", () => {
  assert.equal(hasFeature({ ...parseEntitlements(raw), access: "read_only" }, "serial_tracking"), false);
  assert.equal(READ_ONLY_ENTITLEMENTS.access, "read_only");
});

test("tokens round-trip, expire after 72h, and detect tampering", () => {
  const { token, expiresAt } = signEntitlements(parseEntitlements(raw), "biz-1", secret, now);
  assert.equal(new Date(expiresAt).getTime() - now.getTime(), ENTITLEMENT_TOKEN_TTL_HOURS * 3600_000);
  assert.equal(verifyEntitlements(token, secret, now)?.businessId, "biz-1");
  assert.equal(verifyEntitlements(token, secret, new Date(now.getTime() + 72 * 3600_000)), null, "expired exactly at TTL");
  assert.equal(verifyEntitlements(token, "another-secret-of-sufficient-length!!", now), null, "wrong secret");
  const [body, signature] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), businessId: "biz-2" })).toString("base64url");
  assert.equal(verifyEntitlements(`${forged}.${signature}`, secret, now), null, "tampered body");
  assert.equal(verifyEntitlements("garbage", secret, now), null);
});

test("refuses short secrets", () => {
  assert.throws(() => signEntitlements(parseEntitlements(raw), "biz-1", "short", now), RangeError);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --experimental-strip-types --test tests/entitlements.test.mjs`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Create `lib/billing/entitlements.ts`.** zod 4 is already a dependency. Import it as `import { z } from "zod";` the same way `app/api/v1/business/route.ts` does. A bare package import works under node's test runner.

```ts
import { z } from "zod";
import { PLANS, type FeatureKey, type PlanId } from "./plans.ts";

const FEATURE_KEYS = [...new Set(Object.values(PLANS).flatMap((plan) => plan.features))] as [FeatureKey, ...FeatureKey[]];
const PLAN_IDS = Object.keys(PLANS) as [PlanId, ...PlanId[]];
const limit = z.number().int().nonnegative().nullable();

const entitlementsSchema = z.object({
  planId: z.enum(PLAN_IDS).nullable(),
  status: z.enum(["trialing", "active", "past_due", "canceled"]).nullable(),
  access: z.enum(["full", "read_only"]),
  trialEndsAt: z.string().nullable(),
  graceEndsAt: z.string().nullable(),
  features: z.array(z.enum(FEATURE_KEYS)),
  limits: z.object({ branches: limit, tills: limit, members: limit, products: limit }),
});

export type Entitlements = z.infer<typeof entitlementsSchema>;

export const READ_ONLY_ENTITLEMENTS: Entitlements = {
  planId: null, status: null, access: "read_only", trialEndsAt: null, graceEndsAt: null, features: [],
  limits: { branches: 0, tills: 0, members: 0, products: 0 },
};

export function parseEntitlements(input: unknown): Entitlements {
  return entitlementsSchema.parse(input);
}

export function hasFeature(entitlements: Entitlements, feature: FeatureKey): boolean {
  return entitlements.access === "full" && entitlements.features.includes(feature);
}
```

- [ ] **Step 4: Create `lib/billing/entitlement-token.ts`**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { parseEntitlements, type Entitlements } from "./entitlements.ts";

export const ENTITLEMENT_TOKEN_TTL_HOURS = 72;

type TokenBody = { businessId: string; entitlements: Entitlements; expiresAt: string };

function signature(body: string, secret: string) {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function assertSecret(secret: string) {
  if (secret.length < 32) throw new RangeError("ENTITLEMENT_SIGNING_SECRET must be at least 32 characters.");
}

export function signEntitlements(entitlements: Entitlements, businessId: string, secret: string, now = new Date()) {
  assertSecret(secret);
  const expiresAt = new Date(now.getTime() + ENTITLEMENT_TOKEN_TTL_HOURS * 3600_000).toISOString();
  const body = Buffer.from(JSON.stringify({ businessId, entitlements, expiresAt } satisfies TokenBody)).toString("base64url");
  return { token: `${body}.${signature(body, secret)}`, expiresAt };
}

export function verifyEntitlements(token: string, secret: string, now = new Date()): { businessId: string; entitlements: Entitlements } | null {
  const [body, provided] = token.split(".");
  if (!body || !provided) return null;
  const expected = Buffer.from(signature(body, secret));
  const actual = Buffer.from(provided);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as TokenBody;
    if (new Date(parsed.expiresAt).getTime() <= now.getTime()) return null;
    return { businessId: parsed.businessId, entitlements: parseEntitlements(parsed.entitlements) };
  } catch {
    return null;
  }
}
```

The client cannot verify an HMAC without the secret. It stores the token with its `expiresAt` and trusts it until expiry, falling back to `READ_ONLY_ENTITLEMENTS` afterwards (Task 6). The server re-verifies the token on sync in sub-plan 1F.

- [ ] **Step 5: Create `app/api/v1/entitlements/route.ts`.** Read `node_modules/next/dist/docs/` for route handlers first, and follow the patterns in `app/api/v1/business/route.ts`.

```ts
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { parseEntitlements } from "@/lib/billing/entitlements";
import { signEntitlements } from "@/lib/billing/entitlement-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const secret = process.env.ENTITLEMENT_SIGNING_SECRET;
  if (!secret) return Response.json({ error: "Entitlements are not configured." }, { status: 503 });
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "Authentication is required." }, { status: 401 });
    const { data: membership, error: memberError } = await supabase
      .from("business_members").select("business_id").eq("user_id", user.id).eq("status", "active").limit(1).maybeSingle();
    if (memberError) return Response.json({ error: memberError.message }, { status: 502 });
    if (!membership) return Response.json({ error: "No business is configured for this account." }, { status: 404 });
    const { data, error } = await supabase.rpc("business_entitlements", { target_business_id: membership.business_id });
    if (error) return Response.json({ error: error.message }, { status: 502 });
    const entitlements = parseEntitlements(data);
    const { token, expiresAt } = signEntitlements(entitlements, membership.business_id, secret);
    return Response.json({ businessId: membership.business_id, entitlements, token, expiresAt });
  } catch {
    return Response.json({ error: "Entitlements could not be loaded." }, { status: 503 });
  }
}
```

Add `ENTITLEMENT_SIGNING_SECRET=` under a `# Server only` comment in `.env.example`. Add a generated 48-character value to the worktree's git-ignored `.env.local`, and never commit it.

- [ ] **Step 6: Run the tests, typecheck and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/billing/entitlements.ts lib/billing/entitlement-token.ts app/api/v1/entitlements/route.ts tests/entitlements.test.mjs .env.example
git commit -m "feat(billing): entitlements type, signed offline token and API"
```

---

### Task 4: Shop snapshot (types, pure mapper, API)

**Files:**
- Create: `lib/snapshot/types.ts`, `lib/snapshot/map-rows.ts`, `app/api/v1/snapshot/route.ts`
- Modify: `lib/domain.ts` (add `SupplierSnapshot`; add `supplier?: SupplierSnapshot` to `Sale`)
- Test: `tests/snapshot-map.test.mjs`

**Interfaces:**
- Consumes: `DemoState` and the domain types from `lib/domain.ts`; `Entitlements` (Task 3); `CountryCode`/`CurrencyCode` from `lib/fiscal/countries.ts`
- Produces:
  - `type BusinessProfile = { id: string; legalName: string; trn: string; address: string; phone: string; invoicePrefix: string; receiptFooter: string; country: CountryCode; currency: CurrencyCode }`
  - `type TillDevice = { id: string; name: string; tillNumber: number; branchId: string; status: "active" | "revoked" }`
  - `type ShopSnapshot = { business: BusinessProfile; devices: TillDevice[]; state: DemoState; generatedAt: string }`
  - `type SnapshotRows` (see code)
  - `mapSnapshotRows(rows: SnapshotRows, deviceId: string | null, generatedAt: string): ShopSnapshot`
  - `GET /api/v1/snapshot?deviceId=<uuid>` returns `ShopSnapshot`; the 90-day window applies to sales, credit notes and stock movements

- [ ] **Step 1: Add the domain type.** In `lib/domain.ts`, add the following and set `supplier?: SupplierSnapshot;` on `Sale`:

```ts
export type SupplierSnapshot = { name: string; trn: string; address: string; phone: string };
```

The keys match the `supplier_snapshot` JSON written by `apply_sale_sync` (`name`, `trn`, `address`, `phone`).

- [ ] **Step 2: Write the failing test** in `tests/snapshot-map.test.mjs`

```js
import assert from "node:assert/strict";
import test from "node:test";
import { mapSnapshotRows } from "../lib/snapshot/map-rows.ts";

const rows = {
  business: { id: "biz", legal_name: "Smoke LLC", trn: "100000000000003", address: "Dubai", phone: "+971", invoice_prefix: "SMK", receipt_footer: "Thanks", country: "AE", currency: "AED" },
  devices: [
    { id: "dev-2", name: "Counter 2", till_number: 2, branch_id: "br", status: "active" },
    { id: "dev-1", name: "Counter 1", till_number: 1, branch_id: "br", status: "active" },
  ],
  products: [{ id: "p1", name: "Coffee", sku: "COF", barcode: null, price_fils: 2850, stock_quantity: 4, low_stock_threshold: 5, status: "active" }],
  customers: [{ id: "c1", name: "Omar", phone: "+971 55", email: null, address: null, trn: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z" }],
  sales: [{
    id: "s1", invoice_number: "SMK-1-261013-0001", created_at: "2026-10-13T08:00:00Z", supply_date: "2026-10-13", payment_method: "cash",
    net_fils: 2714, vat_fils: 136, gross_fils: 2850, status: "completed",
    customer_snapshot: null, supplier_snapshot: { name: "Smoke LLC", trn: "100000000000003", address: "Dubai", phone: "+971" },
    sale_items: [{ id: "l1", product_id: "p1", description: "Coffee", sku: "COF", quantity: 1, unit_gross_fils: 2850, net_fils: 2714, vat_fils: 136, gross_fils: 2850 }],
  }],
  creditNotes: [{
    id: "n1", credit_note_number: "CN-1-261013-0001", sale_id: "s1", payment_method: "cash", created_at: "2026-10-13T09:00:00Z",
    net_fils: 2714, vat_fils: 136, gross_fils: 2850,
    credit_note_items: [{ id: "nl1", sale_item_id: "l1", product_id: "p1", description: "Coffee", sku: "COF", quantity: 1, unit_gross_fils: 2850, net_fils: 2714, vat_fils: 136, gross_fils: 2850 }],
  }],
  stockMovements: [{ id: "m1", product_id: "p1", type: "correction_out", quantity_delta: -1, reason: "Broken", created_at: "2026-10-13T07:00:00Z" }],
  register: {
    id: "r1", status: "open", opened_at: "2026-10-13T04:00:00Z", opening_cash_fils: 24000, closed_at: null, counted_cash_fils: null, expected_cash_fils: null, variance_fils: null,
    cash_movements: [
      { id: "a1", type: "adjustment_out", amount_fils: -500, reason: "Petty cash", created_at: "2026-10-13T05:00:00Z" },
      { id: "x1", type: "sale", amount_fils: 2850, reason: "SMK-1-261013-0001", created_at: "2026-10-13T08:00:00Z" },
    ],
  },
};

test("maps business, devices sorted by till number", () => {
  const s = mapSnapshotRows(rows, "dev-1", "2026-10-13T10:00:00Z");
  assert.equal(s.business.invoicePrefix, "SMK");
  assert.deepEqual(s.devices.map((d) => d.tillNumber), [1, 2]);
});

test("maps products, customers and sales with lines and supplier", () => {
  const { state } = mapSnapshotRows(rows, "dev-1", "x");
  assert.deepEqual(state.products[0], { id: "p1", name: "Coffee", sku: "COF", barcode: undefined, priceFils: 2850, stock: 4, lowStockThreshold: 5, active: true });
  assert.equal(state.customers[0].email, undefined);
  assert.equal(state.sales[0].lines[0].productId, "p1");
  assert.equal(state.sales[0].supplier?.name, "Smoke LLC");
  assert.equal(state.sales[0].customer, undefined);
});

test("credit notes link to the original line and invoice number", () => {
  const { state } = mapSnapshotRows(rows, "dev-1", "x");
  assert.equal(state.creditNotes[0].invoiceNumber, "SMK-1-261013-0001");
  assert.equal(state.creditNotes[0].lines[0].originalLineId, "l1");
});

test("stock movement types use the client's hyphenated names", () => {
  assert.equal(mapSnapshotRows(rows, "dev-1", "x").state.stockMovements[0].type, "correction-out");
});

test("register keeps only manual adjustments, signed", () => {
  const register = mapSnapshotRows(rows, "dev-1", "x").state.register;
  assert.equal(register?.status, "open");
  assert.deepEqual(register?.adjustments.map((a) => a.amountFils), [-500]);
});

test("no register row means no register; sync outbox always starts empty", () => {
  const s = mapSnapshotRows({ ...rows, register: null }, null, "x");
  assert.equal(s.state.register, null);
  assert.deepEqual(s.state.syncOperations, []);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --experimental-strip-types --test tests/snapshot-map.test.mjs`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 4: Create `lib/snapshot/types.ts`**

```ts
import type { DemoState } from "../domain.ts";
import type { CountryCode, CurrencyCode } from "../fiscal/countries.ts";

export type BusinessProfile = { id: string; legalName: string; trn: string; address: string; phone: string; invoicePrefix: string; receiptFooter: string; country: CountryCode; currency: CurrencyCode };
export type TillDevice = { id: string; name: string; tillNumber: number; branchId: string; status: "active" | "revoked" };
export type ShopSnapshot = { business: BusinessProfile; devices: TillDevice[]; state: DemoState; generatedAt: string };

type Money = { net_fils: number; vat_fils: number; gross_fils: number };
type LineRow = Money & { id: string; product_id: string | null; description: string; sku: string | null; quantity: number; unit_gross_fils: number };

export type SnapshotRows = {
  business: { id: string; legal_name: string; trn: string; address: string; phone: string; invoice_prefix: string; receipt_footer: string; country: string; currency: string };
  devices: { id: string; name: string; till_number: number; branch_id: string; status: string }[];
  products: { id: string; name: string; sku: string; barcode: string | null; price_fils: number; stock_quantity: number; low_stock_threshold: number; status: string }[];
  customers: { id: string; name: string; phone: string; email: string | null; address: string | null; trn: string | null; created_at: string; updated_at: string }[];
  sales: (Money & { id: string; invoice_number: string; created_at: string; supply_date: string; payment_method: "cash" | "card"; status: string; customer_snapshot: Record<string, unknown> | null; supplier_snapshot: Record<string, unknown> | null; sale_items: LineRow[] })[];
  creditNotes: (Money & { id: string; credit_note_number: string; sale_id: string; payment_method: "cash" | "card"; created_at: string; credit_note_items: (LineRow & { sale_item_id: string })[] })[];
  stockMovements: { id: string; product_id: string; type: string; quantity_delta: number; reason: string; created_at: string }[];
  register: null | { id: string; status: "open" | "closed"; opened_at: string; opening_cash_fils: number; closed_at: string | null; counted_cash_fils: number | null; expected_cash_fils: number | null; variance_fils: number | null; cash_movements: { id: string; type: string; amount_fils: number; reason: string; created_at: string }[] };
};
```

Postgres `bigint` columns arrive from PostgREST as JS numbers for values in this range. The mapper coerces every money field with `Number()`.

- [ ] **Step 5: Create `lib/snapshot/map-rows.ts`**

```ts
import type { CustomerSnapshot, DemoState, InvoiceLine, StockMovement, SupplierSnapshot } from "../domain.ts";
import type { CountryCode, CurrencyCode } from "../fiscal/countries.ts";
import type { ShopSnapshot, SnapshotRows } from "./types.ts";

const optional = (value: string | null) => value ?? undefined;

function mapLine(row: SnapshotRows["sales"][number]["sale_items"][number]): InvoiceLine {
  return {
    id: row.id, productId: optional(row.product_id), name: row.description, sku: optional(row.sku), quantity: row.quantity,
    unitGrossFils: Number(row.unit_gross_fils), netFils: Number(row.net_fils), vatFils: Number(row.vat_fils), grossFils: Number(row.gross_fils),
  };
}

export function mapSnapshotRows(rows: SnapshotRows, deviceId: string | null, generatedAt: string): ShopSnapshot {
  const invoiceBySale = new Map(rows.sales.map((sale) => [sale.id, sale.invoice_number]));
  const state: DemoState = {
    products: rows.products.map((p) => ({
      id: p.id, name: p.name, sku: p.sku, barcode: optional(p.barcode), priceFils: Number(p.price_fils), stock: p.stock_quantity, lowStockThreshold: p.low_stock_threshold, active: p.status === "active",
    })),
    customers: rows.customers.map((c) => ({
      id: c.id, name: c.name, phone: c.phone, email: optional(c.email), address: optional(c.address), trn: optional(c.trn), createdAt: c.created_at, updatedAt: c.updated_at,
    })),
    sales: rows.sales.map((s) => ({
      id: s.id, invoiceNumber: s.invoice_number, createdAt: s.created_at, supplyDate: s.supply_date, paymentMethod: s.payment_method,
      lines: s.sale_items.map(mapLine), netFils: Number(s.net_fils), vatFils: Number(s.vat_fils), grossFils: Number(s.gross_fils),
      customer: (s.customer_snapshot ?? undefined) as CustomerSnapshot | undefined,
      supplier: (s.supplier_snapshot ?? undefined) as SupplierSnapshot | undefined,
      status: "completed" as const,
    })),
    creditNotes: rows.creditNotes.map((n) => ({
      id: n.id, creditNoteNumber: n.credit_note_number, saleId: n.sale_id, invoiceNumber: invoiceBySale.get(n.sale_id) ?? "", createdAt: n.created_at, paymentMethod: n.payment_method,
      lines: n.credit_note_items.map((item) => ({ ...mapLine(item), originalLineId: item.sale_item_id })),
      netFils: Number(n.net_fils), vatFils: Number(n.vat_fils), grossFils: Number(n.gross_fils),
    })),
    stockMovements: rows.stockMovements.map((m) => ({
      id: m.id, productId: m.product_id, delta: m.quantity_delta, type: m.type.replace("_", "-") as StockMovement["type"], reason: m.reason, createdAt: m.created_at,
    })),
    syncOperations: [],
    register: rows.register ? {
      id: rows.register.id, status: rows.register.status, openedAt: rows.register.opened_at, openingCashFils: Number(rows.register.opening_cash_fils),
      adjustments: rows.register.cash_movements.filter((m) => m.type === "adjustment_in" || m.type === "adjustment_out")
        .map((m) => ({ id: m.id, amountFils: Number(m.amount_fils), reason: m.reason, createdAt: m.created_at })),
      closedAt: optional(rows.register.closed_at),
      countedCashFils: rows.register.counted_cash_fils === null ? undefined : Number(rows.register.counted_cash_fils),
      expectedCashFils: rows.register.expected_cash_fils === null ? undefined : Number(rows.register.expected_cash_fils),
      varianceFils: rows.register.variance_fils === null ? undefined : Number(rows.register.variance_fils),
    } : null,
  };
  void deviceId;
  return {
    business: {
      id: rows.business.id, legalName: rows.business.legal_name, trn: rows.business.trn, address: rows.business.address, phone: rows.business.phone,
      invoicePrefix: rows.business.invoice_prefix, receiptFooter: rows.business.receipt_footer, country: rows.business.country as CountryCode, currency: rows.business.currency as CurrencyCode,
    },
    devices: rows.devices.map((d) => ({ id: d.id, name: d.name, tillNumber: d.till_number, branchId: d.branch_id, status: d.status === "active" ? "active" as const : "revoked" as const }))
      .sort((left, right) => left.tillNumber - right.tillNumber),
    state,
    generatedAt,
  };
}
```

Remove the unused `deviceId` parameter if lint complains about `void`. In that case also drop it from the interface, and pass the register for the device from the route instead. The route already selects the register by device, so the mapper does not need the ID.

- [ ] **Step 6: Run the mapper tests**

Run: `node --experimental-strip-types --test tests/snapshot-map.test.mjs`
Expected: PASS.

- [ ] **Step 7: Create `app/api/v1/snapshot/route.ts`.** Read the route-handler docs in `node_modules/next/dist/docs/` first. All queries go through the user's RLS-scoped client.

```ts
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { mapSnapshotRows } from "@/lib/snapshot/map-rows";
import type { SnapshotRows } from "@/lib/snapshot/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HISTORY_DAYS = 90;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const deviceParam = new URL(request.url).searchParams.get("deviceId");
  const deviceId = deviceParam && UUID.test(deviceParam) ? deviceParam : null;
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "Authentication is required." }, { status: 401 });

    const { data: membership } = await supabase.from("business_members").select("business_id").eq("user_id", user.id).eq("status", "active").limit(1).maybeSingle();
    if (!membership) return Response.json({ error: "No business is configured for this account." }, { status: 404 });
    const businessId = membership.business_id as string;
    const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString();

    const [business, devices, products, customers, sales, creditNotes, stockMovements, register] = await Promise.all([
      supabase.from("businesses").select("id, legal_name, trn, address, phone, invoice_prefix, receipt_footer, country, currency").eq("id", businessId).single(),
      supabase.from("devices").select("id, name, till_number, branch_id, status").eq("business_id", businessId),
      supabase.from("products").select("id, name, sku, barcode, price_fils, stock_quantity, low_stock_threshold, status").eq("business_id", businessId).order("name"),
      supabase.from("customers").select("id, name, phone, email, address, trn, created_at, updated_at").eq("business_id", businessId).order("created_at", { ascending: false }),
      supabase.from("sales").select("id, invoice_number, created_at, supply_date, payment_method, net_fils, vat_fils, gross_fils, status, customer_snapshot, supplier_snapshot, sale_items(id, product_id, description, sku, quantity, unit_gross_fils, net_fils, vat_fils, gross_fils)").eq("business_id", businessId).gte("created_at", since).order("created_at", { ascending: false }),
      supabase.from("credit_notes").select("id, credit_note_number, sale_id, payment_method, created_at, net_fils, vat_fils, gross_fils, credit_note_items(id, sale_item_id, product_id, description, sku, quantity, unit_gross_fils, net_fils, vat_fils, gross_fils)").eq("business_id", businessId).gte("created_at", since).order("created_at", { ascending: false }),
      supabase.from("stock_movements").select("id, product_id, type, quantity_delta, reason, created_at").eq("business_id", businessId).gte("created_at", since).order("created_at", { ascending: false }),
      deviceId
        ? supabase.from("register_sessions").select("id, status, opened_at, opening_cash_fils, closed_at, counted_cash_fils, expected_cash_fils, variance_fils, cash_movements(id, type, amount_fils, reason, created_at)").eq("business_id", businessId).eq("device_id", deviceId).order("opened_at", { ascending: false }).limit(1).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    const failed = [business, devices, products, customers, sales, creditNotes, stockMovements, register].find((result) => result.error);
    if (failed?.error) return Response.json({ error: failed.error.message }, { status: 502 });

    const rows = {
      business: business.data, devices: devices.data ?? [], products: products.data ?? [], customers: customers.data ?? [],
      sales: sales.data ?? [], creditNotes: creditNotes.data ?? [], stockMovements: stockMovements.data ?? [], register: register.data ?? null,
    } as unknown as SnapshotRows;
    return Response.json(mapSnapshotRows(rows, deviceId, new Date().toISOString()));
  } catch {
    return Response.json({ error: "The shop snapshot could not be loaded." }, { status: 503 });
  }
}
```

Before relying on the selects, check every column name against migrations `0001`–`0009` and `010`–`016`. If a name differs (for example `stock_movements.quantity_delta`), fix the select and the `SnapshotRows` type together, and note it in your report.

- [ ] **Step 8: Run the tests, typecheck and lint, then commit**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add lib/domain.ts lib/snapshot/types.ts lib/snapshot/map-rows.ts app/api/v1/snapshot/route.ts tests/snapshot-map.test.mjs
git commit -m "feat: shop snapshot types, row mapper and API"
```

---

### Task 5: Merge a server snapshot with unsynced local work

**Files:**
- Create: `lib/snapshot/merge.ts`
- Test: `tests/snapshot-merge.test.mjs`

**Interfaces:**
- Consumes: `DemoState`, `SyncOperation`
- Produces: `mergeSnapshot(server: DemoState, local: DemoState): DemoState`. The rules:
  - start from the server state
  - keep every local `syncOperations` entry whose status is not `synced`
  - for each kept operation, keep the local entity it carries:
    - `sale`: the local sale stays if the server doesn't have it, and its stock decrements apply to server product stock
    - `credit-note`: the same, with stock increments
    - `customer`: the local customer replaces or adds
    - `stock`: the local movement is added and product stock adjusted
    - `register`: the local register replaces the server register
  - never duplicate entities that the server already has (match by `id`)

- [ ] **Step 1: Write the failing test** in `tests/snapshot-merge.test.mjs`

```js
import assert from "node:assert/strict";
import test from "node:test";
import { mergeSnapshot } from "../lib/snapshot/merge.ts";

const product = { id: "p1", name: "Coffee", sku: "COF", priceFils: 2850, stock: 10, lowStockThreshold: 2, active: true };
const line = { id: "l1", productId: "p1", name: "Coffee", sku: "COF", quantity: 2, unitGrossFils: 2850, netFils: 5429, vatFils: 271, grossFils: 5700 };
const sale = { id: "s-local", invoiceNumber: "SMK-1-261013-0003", createdAt: "2026-10-13T09:00:00Z", supplyDate: "2026-10-13", paymentMethod: "cash", lines: [line], netFils: 5429, vatFils: 271, grossFils: 5700, status: "completed" };
const empty = { products: [], stockMovements: [], sales: [], customers: [], creditNotes: [], syncOperations: [], register: null };
const server = { ...empty, products: [product] };
const op = (status, entity = "sale", payload = { sale }) => ({ id: `op-${status}-${entity}`, entity, entityId: payload.sale?.id ?? "x", createdAt: "2026-10-13T09:00:00Z", status, payload });

test("pending local sale survives a refresh and decrements server stock once", () => {
  const local = { ...empty, products: [{ ...product, stock: 8 }], sales: [sale], syncOperations: [op("pending")] };
  const merged = mergeSnapshot(server, local);
  assert.deepEqual(merged.sales.map((s) => s.id), ["s-local"]);
  assert.equal(merged.products[0].stock, 8);
  assert.equal(merged.syncOperations.length, 1);
});

test("once the server has the sale, it is not duplicated or double-decremented", () => {
  const serverWithSale = { ...server, products: [{ ...product, stock: 8 }], sales: [sale] };
  const local = { ...empty, sales: [sale], syncOperations: [op("pending")] };
  const merged = mergeSnapshot(serverWithSale, local);
  assert.equal(merged.sales.length, 1);
  assert.equal(merged.products[0].stock, 8);
});

test("synced operations are dropped and their entities come only from the server", () => {
  const merged = mergeSnapshot(server, { ...empty, sales: [sale], syncOperations: [op("synced")] });
  assert.equal(merged.sales.length, 0);
  assert.equal(merged.syncOperations.length, 0);
});

test("failed operations are kept for review", () => {
  assert.equal(mergeSnapshot(server, { ...empty, sales: [sale], syncOperations: [op("failed")] }).syncOperations.length, 1);
});

test("a pending local register replaces the server register", () => {
  const register = { id: "r-local", status: "open", openedAt: "2026-10-13T04:00:00Z", openingCashFils: 100, adjustments: [] };
  const merged = mergeSnapshot({ ...server, register: null }, { ...empty, register, syncOperations: [op("pending", "register", { action: "open", register })] });
  assert.equal(merged.register?.id, "r-local");
});

test("a pending customer edit wins over the server copy", () => {
  const serverCustomer = { id: "c1", name: "Old", phone: "1", createdAt: "a", updatedAt: "a" };
  const localCustomer = { ...serverCustomer, name: "New", updatedAt: "b" };
  const merged = mergeSnapshot({ ...server, customers: [serverCustomer] }, { ...empty, customers: [localCustomer], syncOperations: [{ ...op("pending", "customer", { customer: localCustomer }), entityId: "c1" }] });
  assert.equal(merged.customers[0].name, "New");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --experimental-strip-types --test tests/snapshot-merge.test.mjs`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Create `lib/snapshot/merge.ts`**

```ts
import type { DemoState, Product } from "../domain.ts";

function adjust(products: Product[], deltas: Map<string, number>): Product[] {
  return products.map((product) => deltas.has(product.id) ? { ...product, stock: product.stock + deltas.get(product.id)! } : product);
}

export function mergeSnapshot(server: DemoState, local: DemoState): DemoState {
  const kept = local.syncOperations.filter((operation) => operation.status !== "synced");
  const merged: DemoState = { ...server, syncOperations: kept };
  const deltas = new Map<string, number>();
  const addDelta = (productId: string | undefined, delta: number) => {
    if (productId) deltas.set(productId, (deltas.get(productId) ?? 0) + delta);
  };

  for (const operation of [...kept].sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    const payload = operation.payload;
    if (!payload) continue;
    if (operation.entity === "sale" && "sale" in payload && !merged.sales.some((sale) => sale.id === payload.sale.id)) {
      merged.sales = [payload.sale, ...merged.sales];
      for (const line of payload.sale.lines) addDelta(line.productId, -line.quantity);
    } else if (operation.entity === "credit-note" && "creditNote" in payload && !merged.creditNotes.some((note) => note.id === payload.creditNote.id)) {
      merged.creditNotes = [payload.creditNote, ...merged.creditNotes];
      for (const line of payload.creditNote.lines) addDelta(line.productId, line.quantity);
    } else if (operation.entity === "customer" && "customer" in payload) {
      merged.customers = [payload.customer, ...merged.customers.filter((customer) => customer.id !== payload.customer.id)];
    } else if (operation.entity === "stock" && "movement" in payload && !merged.stockMovements.some((movement) => movement.id === payload.movement.id)) {
      merged.stockMovements = [payload.movement, ...merged.stockMovements];
      if (!merged.products.some((product) => product.id === payload.product.id)) merged.products = [{ ...payload.product, stock: 0 }, ...merged.products];
      addDelta(payload.movement.productId, payload.movement.delta);
    } else if (operation.entity === "register" && "action" in payload) {
      merged.register = local.register;
    }
  }

  merged.products = adjust(merged.products, deltas);
  return merged;
}
```

- [ ] **Step 4: Run the tests**

Run: `node --experimental-strip-types --test tests/snapshot-merge.test.mjs && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/snapshot/merge.ts tests/snapshot-merge.test.mjs
git commit -m "feat: merge server snapshots with unsynced local work"
```

---

### Task 6: Hosted mode in the store, and device-aware sync

**Files:**
- Create: `lib/device.ts`
- Modify: `lib/demo-store.ts`, `app/api/v1/sync/route.ts`, `app/api/v1/business/route.ts`

**Interfaces:**
- Consumes: `ShopSnapshot`, `BusinessProfile`, `TillDevice` (Task 4); `mergeSnapshot` (Task 5); `nextInvoiceNumber`, `nextCreditNoteNumber`, `dubaiSupplyDate` (Task 2); `Entitlements`, `READ_ONLY_ENTITLEMENTS` (Task 3)
- Produces (all exported from `lib/demo-store.ts`; existing exports keep their signatures):
  - `type StoreMode = "hosted" | "sample" | "unconfigured"`
  - `getStoreMode(): StoreMode`
  - `startHostedStore(): Promise<{ ok: true } | { ok: false; error: string }>`, which loads the snapshot and entitlements
  - `startSampleStore(): void`
  - `useShopContext(): { mode: StoreMode; business: BusinessProfile | null; device: TillDevice | null; devices: TillDevice[]; entitlements: Entitlements; lastRefreshedAt: string | null }`
  - `refreshSnapshot(): Promise<void>`
  - `lib/device.ts`: `getStoredDeviceId(): string | null`, `storeDeviceId(id: string): void`, `clearStoredDeviceId(): void`, using localStorage key `shop-ledger-device-v1`

- [ ] **Step 1: Create `lib/device.ts`**

```ts
const DEVICE_KEY = "shop-ledger-device-v1";

export function getStoredDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(DEVICE_KEY); } catch { return null; }
}

export function storeDeviceId(id: string): void {
  try { window.localStorage.setItem(DEVICE_KEY, id); } catch { /* storage unavailable: the till picker will ask again */ }
}

export function clearStoredDeviceId(): void {
  try { window.localStorage.removeItem(DEVICE_KEY); } catch { /* ignore */ }
}
```

- [ ] **Step 2: Change `lib/demo-store.ts`.** Make exactly these changes, and keep every other export and signature as it is:
  1. **New module state:** next to `state`, add
     - `let mode: StoreMode = "unconfigured";`
     - `let context: { business: BusinessProfile | null; device: TillDevice | null; devices: TillDevice[]; entitlements: Entitlements; lastRefreshedAt: string | null }`, initialised with nulls, `[]` and `READ_ONLY_ENTITLEMENTS`
     - a separate `contextListeners` set, plus `useShopContext()` built on `useSyncExternalStore`
  2. **Hosted cache keys:** use `const HOSTED_KEY = "shop-ledger-hosted-store-v1";` for hosted mode, and keep `STORE_KEY` for sample mode only. In hosted mode, `save()` writes `HOSTED_KEY` and **never** reads or writes `STORE_KEY`, `LEGACY_PRODUCT_KEY` or `SETTINGS_KEY` (Review Focus 5). The hosted cache stores `{ state, context }` together.
  3. **`hydrate()`:**
     - `"sample"`: keeps today's behaviour.
     - `"hosted"`: reads `HOSTED_KEY`; if it is missing, uses an empty `DemoState` (all arrays empty, `register: null`). It never falls back to `initialState`.
     - `"unconfigured"`: does nothing.
  4. **`startHostedStore()`:**
     - Sets `mode = "hosted"`, then hydrates from `HOSTED_KEY`.
     - Fetches `/api/v1/snapshot?deviceId=${getStoredDeviceId() ?? ""}` and `/api/v1/entitlements` in parallel.
     - On a snapshot success, sets `state = mergeSnapshot(snapshot.state, state)` and sets `context` from the snapshot (device = `snapshot.devices.find((d) => d.id === getStoredDeviceId()) ?? null`), then saves and emits.
     - On an entitlements success, stores `{ entitlements, expiresAt }` in context and the cache. When offline or on failure, it keeps the cached entitlements unless `expiresAt` has passed, in which case it uses `READ_ONLY_ENTITLEMENTS`.
     - Returns `{ ok: false, error }` only when there is no cache AND the snapshot fails.
  5. **`refreshSnapshot()`:** the same snapshot fetch and merge as above. Call it at the end of `reconcilePendingOperations()` whenever `acceptedCount > 0`.
  6. **`startSampleStore()`:** sets `mode = "sample"`, writes `sessionStorage["shop-ledger-mode"] = "sample"` in a try/catch, and hydrates as today.
  7. **Remove the `navigator.onLine && !isSupabaseConfigured()` short-circuits** from the five `queue*Operation` helpers. In hosted mode always enqueue; in sample mode never enqueue (`if (mode !== "hosted") return next;`).
  8. **`deviceId` on every payload:** `enqueueOperation` adds `deviceId: context.device?.id` to the payload object. Extend the `SaleSyncPayload` etc. types in `lib/domain.ts` with an optional `deviceId?: string`. For customer operations, put `deviceId` next to `customer` in the payload, i.e. `{ customer, deviceId }`.
  9. **Numbering:**
     - `completeSale` builds `invoiceNumber` with `nextInvoiceNumber(prefix, tillNumber, now, state.sales.map((s) => s.invoiceNumber))`, where `prefix = context.business?.invoicePrefix ?? invoicePrefix()` and `tillNumber = context.device?.tillNumber ?? 1`. In hosted mode with no device, `completeSale` returns `{ ok: false, error: "Choose which till this browser is before selling." }`.
     - `createCreditNote` uses `nextCreditNoteNumber(tillNumber, now, state.creditNotes.map((n) => n.creditNoteNumber))`.
     - Replace `uaeDateCode`/`uaeSupplyDate` with `dubaiSupplyDate` from `lib/invoice-numbers.ts`, and delete the local helpers.
     - In hosted mode, `sale.supplier` is set from `context.business` (`{ name: legalName, trn, address, phone }`).
  10. **Backup:** `restoreDemoStateBackup` returns `{ ok: false, error: "Restoring a backup is only available in the sample shop. Your hosted data is stored safely on the server." }` in hosted mode.

- [ ] **Step 3: Change `app/api/v1/sync/route.ts`**
  - Replace the business lookup `.from("businesses").select("id").eq("owner_id", user.id)` with `.from("business_members").select("business_id").eq("user_id", user.id).eq("status", "active").limit(1).maybeSingle()`, and use `membership.business_id`.
  - Extend the zod `requestSchema` so each payload accepts an optional `deviceId: z.string().uuid().optional()` (for customer operations, at the payload root next to `customer`).
  - For customer operations, call the RPC with `p_payload: { ...operation.payload.customer, deviceId: operation.payload.deviceId }`.
  - For all other entities, pass the payload unchanged; it already carries `deviceId`.

- [ ] **Step 4: Change `app/api/v1/business/route.ts`.** In both GET and PATCH, find the business through `business_members` the same way as in Step 3. Select the business with `.eq("id", membership.business_id)` instead of `.eq("owner_id", user.id)`. PATCH stays owner-only; RLS (`has_role(id,'owner')`) enforces that, and a non-owner gets a 403 with "Only the owner can change business settings." when the update returns no row.

- [ ] **Step 5: Verify with the existing unit tests, typecheck and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS. The store is browser code and is verified in Task 8's smoke test, while its pure parts are covered by Tasks 2, 4 and 5.

- [ ] **Step 6: Commit**

```bash
git add lib/device.ts lib/demo-store.ts lib/domain.ts app/api/v1/sync/route.ts app/api/v1/business/route.ts
git commit -m "feat: hosted store mode with server snapshots and device-aware sync"
```

---

### Task 7: Screens: setup, till picker, auth gate, sample mode, supplier details

**Files:**
- Create: `components/till-picker.tsx`
- Modify: `components/business-setup.tsx`, `components/auth-gate.tsx`, `components/invoice-detail-workspace.tsx`, `app/(dashboard)/settings/page.tsx`, `app/(dashboard)/overview/page.tsx`, `app/login/page.tsx`, `components/app-shell.tsx`

**Interfaces:**
- Consumes: `startHostedStore`, `startSampleStore`, `getStoreMode`, `useShopContext`, `refreshSnapshot` (Task 6); `storeDeviceId`, `getStoredDeviceId` (Task 6); `enabledCountries` (1A)
- Produces: UI only

- [ ] **Step 1: `components/business-setup.tsx`**
  - Remove all reads and writes of `shop-ledger-demo-settings-v1` and `shop-ledger-cloud-context-v1`.
  - Add a read-only "Country: United Arab Emirates" line, derived from `enabledCountries()[0]`.
  - Insert the business with `country: "AE"`, `currency: "AED"`, `timezone: "Asia/Dubai"`, derived from the profile and not hard-coded strings.
  - Change the device insert to `.insert({ business_id, name }).select("id").single()`, then `storeDeviceId(device.id)` before `router.replace("/overview")`.
  - Change the label "15-digit UAE TRN" to the profile's `taxIdLabel` plus "(15 digits)".

- [ ] **Step 2: Create `components/till-picker.tsx`.** Use the existing class names (`auth-shell`, `auth-card`, `panel`, `field`, `button primary`). It shows:
  - the heading "Which till is this browser?"
  - a list of the active devices from `useShopContext().devices` as buttons: "Till {tillNumber} · {name}". Clicking one calls `storeDeviceId(id)` then `refreshSnapshot()`.
  - a "Register a new till" form with one name field. It inserts into `devices` via `createClient()`. On the `plan_limit_reached` error message it shows "Your plan allows {limits.tills} till(s). Use an existing till or upgrade." Otherwise it stores the ID and refreshes.

- [ ] **Step 3: `components/auth-gate.tsx`.** After the existing session and business checks succeed, and only when Supabase is configured:
  - `await startHostedStore()`, showing the existing loading markup until it resolves. On `{ ok: false }`, render the error in a `notice error-notice` with a Retry button.
  - If `useShopContext().device` is null and the path is not `/setup`, render `<TillPicker />` instead of `children`.
  - When `sessionStorage["shop-ledger-mode"] === "sample"` and Supabase is not configured, call `startSampleStore()`.

- [ ] **Step 4: `app/login/page.tsx`.** Under the sign-in form, add a secondary button "Try the sample shop", with the copy "Explore with demo data. Nothing is saved to an account." It calls `startSampleStore()` and goes to `/overview`. When Supabase is configured, `AuthGate` must let sample mode through without a session: skip the session check when `getStoreMode() === "sample"`.

- [ ] **Step 5: Banners and identity**
  - `app/(dashboard)/overview/page.tsx`: show the existing "Local demo mode" notice only when `getStoreMode() === "sample"`, reworded to "Sample shop. This is demo data and nothing is saved to an account."
  - `components/app-shell.tsx`: replace the `LOCAL CACHE` badge text with `Till {device.tillNumber}` in hosted mode, `Sample shop` in sample mode, and nothing when unconfigured. Replace "Single shop workspace" with `business?.legalName ?? "Shop Ledger"`.
  - `components/invoice-detail-workspace.tsx`: take the supplier identity from `sale.supplier` first, then `useShopContext().business` (legalName/trn/address/phone/receiptFooter), then the existing localStorage settings only in sample mode.
  - `app/(dashboard)/settings/page.tsx`: in hosted mode, prefill the form from `useShopContext().business` instead of `localStorage`. After a successful PATCH, call `refreshSnapshot()`. Hide "Cloud catalog → Upload catalog" in hosted mode, because the catalog is already on the server. Hide "Restore backup" in hosted mode.

- [ ] **Step 6: Verify**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/till-picker.tsx components/business-setup.tsx components/auth-gate.tsx components/invoice-detail-workspace.tsx components/app-shell.tsx "app/(dashboard)/settings/page.tsx" "app/(dashboard)/overview/page.tsx" app/login/page.tsx
git commit -m "feat: till picker, hosted identity, and explicit sample shop"
```

---

### Task 8: End-to-end smoke on local Supabase (two tills)

**Files:** none, unless a defect is found. Fixes come with a failing test first and a `fix:` commit.

- [ ] **Step 1:** Run `supabase db reset` on the local stack.
  - Create two local test users through the auth admin API: the owner, and a second browser profile simulated by clearing storage between steps.
  - Store their credentials only in the worktree's git-ignored `.env.local`.
  - Start the dev server on port 3101 from the worktree.
- [ ] **Step 2 (setup):** Sign in as the owner and register the shop through `/setup`. Expect:
  - no demo data anywhere
  - the app shell shows "Till 1"
  - Overview shows no sample banner
- [ ] **Step 3 (catalog):** Add one product (stock 10) on Inventory. After sync, the database has the product with the browser's id, and stock 10.
- [ ] **Step 4 (till 1 sale):** Open the register (100.00) and sell 2 units for cash. Expect:
  - invoice `PREFIX-1-YYMMDD-0001`
  - the database sale's `device_id` is till 1's device
  - stock is 8
- [ ] **Step 5 (till 2):** Clear localStorage, sessionStorage and IndexedDB for `localhost:3101` only. **Do not clear cookies**: they are shared across localhost ports and would sign the owner out of other local apps. Reload, so the till picker appears, and register "Till 2". Then open the register and sell 1 unit. Expect:
  - invoice `PREFIX-2-YYMMDD-0001`
  - `device_id` is till 2
  - stock is 7
  - a third till fails with the plan-limit message (Pro trial = 2 tills)
- [ ] **Step 6 (offline):** In DevTools Network, set "Offline" using the browser tool's network emulation if it is available. Otherwise stop the local API with `supabase stop --no-backup`, then restart it. Sell 1 unit; it shows immediately with a pending sync. Restore the network, and the sale syncs exactly once: one sales row, stock 6. The sale is still visible after the refresh (Review Focus 1).
- [ ] **Step 7 (legacy demo data):** In the browser, set `localStorage["shop-ledger-demo-store-v2"]` to a copy of the sample state, then reload as the owner. No demo invoices (`SL-260830-…`) appear (Review Focus 5).
- [ ] **Step 8 (sample shop):** Sign out, then click "Try the sample shop". Demo data shows with the sample banner, and no network calls to `/api/v1/sync` happen.
- [ ] **Step 9:** Record the results in the PR description: "1B smoke check passed" with the invoice numbers observed. Run `npm run test:sql`, `npm run test:rehearsal`, `npm test`, `npm run lint` and `npm run build`; all pass.

---

## Sub-plan 1B exit criteria

- All suites pass: unit, SQL, rehearsal, lint and build.
- Signed-in shops see only server data. Two tills issue distinct per-till invoice numbers, and the server books each sale to the right till.
- An offline sale survives a refresh and syncs exactly once.
- `GET /api/v1/entitlements` returns parsed entitlements plus a 72h token. The store exposes them through `useShopContext()` for 1F.
- Sub-plans 1C, 1D and 1E can build on `useShopContext()`, `refreshSnapshot()`, the till-aware numbering, and `ShopSnapshot`.
