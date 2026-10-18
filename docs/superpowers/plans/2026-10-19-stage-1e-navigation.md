# Stage 1E Navigation and Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pages are one or two taps away on a phone. Sales, Customers and Inventory can be searched and paged; old sales are found on the server. The app frame gets a user menu, plain sync status, slim summary lines, in-app dialogs and toasts, loading skeletons and Settings tabs.

**Architecture:**
- **Pure logic** lives in `lib/lists/*` (search, phone matching, paging, date chips, merging results), `lib/sync/status-text.ts` and `lib/ui/*-store.ts`, all Node-tested.
- **Shared UI parts** live in `components/ui/*`: confirm dialog, toaster, pager, summary strip, empty state, skeleton.
- **Old sales** come from a new owner-only Postgres RPC, `search_sales`, behind two Next route handlers.

**Tech Stack:** Next.js 16, React 19 (`useSyncExternalStore`), Supabase Postgres (plpgsql, RLS), zod 4, Node 24 test runner. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-19-stage-1e-navigation-design.md`. It is the binding authority; §2 holds the owner's decisions and §9 the designer's calls.

## Global Constraints

- **Next.js:** read `node_modules/next/dist/docs/` before using routing, `useSearchParams` or route-handler APIs. This version differs from training data (`AGENTS.md`).
- **No new runtime dependencies.**
- **Phone layout** (≤ 760px, the existing breakpoint): at 375px there is no horizontal page scroll and every touch target is at least 44px. **Desktop** at 761px and above: the top bar never wraps.
- **ESLint React-compiler rules:** no synchronous setState in effects (use `setTimeout`), and no ref reads during render. Anything read from `window`/`localStorage` loads after mount, to stay hydration-safe.
- **Pure modules** use relative `.ts` imports and are tested with `node --experimental-strip-types --test tests/*.test.mjs` (`npm test`).
- **Migrations:** add new files only; re-apply `search_path = public, extensions, pg_temp` on any function; add SQL tests to `supabase/tests/foundation_test.sql`. Use local Supabase only and **never push to hosted**.
- **Owner decisions (spec §2):**
  - Phone bar: **Overview · Sales · New sale (centre, highlighted) · Inventory · More**.
  - More holds Customers, Register, Reports, Settings, the till, the account, sync status and Sign out.
  - Pages of **50**, with "‹ Previous", "51–100 of 1,240", "Next ›".
  - Sales chips: **Last 30 days (default) · Today · This year · All**. The browser holds 90 days; This year and All search the server.
  - Server sales are **view and reprint only**. **Reports keeps its one-day report**, plus the compact strip.
- **Fixed copy:**
  - offline message for server chips: `Older sales can be searched when this device is online. Showing the last 90 days.`
  - no refund on a server-only sale: `Refunds are available for sales in the last 90 days.`
  - sync texts: `Online · all synced`, `Syncing · N left`, `Offline · N waiting`, `Offline · all saved`, `N need attention`, `Sample shop · not synced`.

## Review Focus

These are the failure modes the unit tests won't catch. Each is pinned in the smoke test (Task 9) or by a named test.

1. **The phone bar and More sheet beside the POS:** the bottom bar never overlaps the POS cart bar or the receipt sheet, and the cart sheet sits on the cart bar (Task 4 browser check; Task 9, check 2).
2. **The More sheet and the confirm dialog with keyboard and screen reader:** focus is trapped, Escape closes, and focus returns to the opener (Task 3 and Task 4 browser checks).
3. **"All" offline:** the fixed message appears and the list falls back to 90 days. Online, a sale made offline today shows once in the "All" results (Task 6 merge test; Task 9, check 5).
4. **Top bar at 761–1024px with a long shop name:** it is cut off with an ellipsis and never wraps (Task 4 browser check at 761, 820 and 1024px).
5. **Old-sale access:** an owner of business B can never get business A's sales through `search_sales` or `/api/v1/sales/[id]` (Task 5, SQL section 23).

---

## File map

| Path | Responsibility |
|---|---|
| `lib/lists/search.ts` | `normalizePhone`, `phoneMatches`, `saleMatches`, `customerMatches` |
| `lib/lists/paging.ts` | `paginate`, `PAGE_SIZE` |
| `lib/lists/date-chips.ts` | `DateChip`, `chipRange`, `chipIsServer` |
| `lib/lists/merge-results.ts` | `mergeUnsyncedSales` |
| `lib/sync/status-text.ts` | `syncStatus` |
| `lib/ui/toast-store.ts` | Toast queue (at most 3) and subscribe/notify |
| `lib/ui/confirm-store.ts` | Promise-based confirm request queue |
| `components/ui/confirm-host.tsx`, `toaster.tsx`, `pager.tsx`, `summary-strip.tsx`, `empty-state.tsx`, `skeleton.tsx` | Shared UI |
| `components/app-shell.tsx`, `components/nav/more-sheet.tsx`, `components/nav/user-menu.tsx` | Navigation |
| `components/offline-runtime.tsx` | Sync status (uses `syncStatus`) |
| `supabase/migrations/202610190022_sales_search.sql` | `search_sales` and `get_sale_detail` RPCs, plus an index |
| `app/api/v1/sales/search/route.ts`, `app/api/v1/sales/[id]/route.ts` | Owner-only server sales |
| `lib/snapshot/map-rows.ts` | `mapSaleRow`, exported and reused by the sale route |
| Modified pages | `components/{sales,customers,inventory,reports,invoice-detail}-workspace.tsx`, `app/(dashboard)/settings/page.tsx`, `app/(dashboard)/overview/page.tsx`, `components/pos-workspace.tsx`, `components/pos/held-carts.tsx`, `components/catalogue/label-print-dialog.tsx`, `app/globals.css` |

---

### Task 1: List logic (search, phone matching, paging, date chips, merging)

**Files:**
- Create: `lib/lists/search.ts`, `lib/lists/paging.ts`, `lib/lists/date-chips.ts`, `lib/lists/merge-results.ts`
- Test: `tests/lists.test.mjs`

**Interfaces:**
- `normalizePhone(text: string): string`
  - Keep digits only.
  - Strip a leading `00971` or `971`, then a leading `0`.
  - Examples: `+971 55 555 0198`, `0555550198` and `55-555-0198` all become `555550198`.
- `phoneMatches(query: string, phone: string | undefined): boolean`
  - true when the normalised query has at least 4 digits and is a substring of the normalised phone.
- `saleMatches(sale: Sale, query: string): boolean`
  - an empty query matches;
  - otherwise a case-insensitive substring of `invoiceNumber`, or of `customer?.name`, or `phoneMatches` on `customer?.phone`.
- `customerMatches(customer: Customer, query: string): boolean`
  - a substring of name, email or TRN, or `phoneMatches` on phone.
- `PAGE_SIZE = 50`.
- `paginate<T>(items: T[], page: number, size = PAGE_SIZE): { items: T[]; page: number; pageCount: number; from: number; to: number; total: number }`
  - page is 1-based and clamped to `1..max(1, pageCount)`;
  - `from` and `to` are 1-based, and both 0 when `total` is 0.
- `type DateChip = "last30" | "today" | "year" | "all"`.
- `chipRange(chip: DateChip, now: Date): { from: string | null; to: string }` gives Dubai business dates (`YYYY-MM-DD`) via `dubaiSupplyDate`:
  - `last30`: from = today − 29 days;
  - `today`: from = today;
  - `year`: from = `YYYY-01-01`;
  - `all`: from = `null`.
- `chipIsServer(chip: DateChip): boolean` is true for `year` and `all`.
- `localHistoryRange(now: Date): { from: string; to: string }` covers the 90 days the browser holds (from = today − 89 days). It is used when a server chip falls back offline.
- `mergeUnsyncedSales(serverRows: SaleRow[], unsynced: Sale[], query: string, range: { from: string | null; to: string }): SaleRow[]`
  - adds the unsynced local sales that match the query and range and aren't already in `serverRows` (by id);
  - newest first.
  - `SaleRow = { id: string; invoiceNumber: string; customerName?: string; customerPhone?: string; supplyDate: string; createdAt: string; paymentMethod: PaymentMethod; grossFils: number; local?: true }`, exported from `merge-results.ts`.
- `saleToRow(sale: Sale): SaleRow`, exported from `merge-results.ts`.

- [ ] **Step 1: Write the failing tests** in `tests/lists.test.mjs`:
  - `normalizePhone` of each of `"+971 55 555 0198"`, `"0555550198"`, `"55-555-0198"` and `"00971555550198"` equals `"555550198"`.
  - `phoneMatches("0198", "+971 55 555 0198")` is true; `phoneMatches("019", …)` is false (under 4 digits); `phoneMatches("1234", undefined)` is false.
  - `saleMatches`:
    - `"smk-1-2610"` finds an invoice `SMK-1-261017-0042`;
    - `"omar"` finds customer "Omar Hassan";
    - `"0555550198"` finds a customer whose phone is `+971 55 555 0198`;
    - `""` matches;
    - `"zzz"` doesn't.
  - `customerMatches` is true for a TRN substring and for the phone formats above.
  - `paginate`:
    - 0 items gives `{ page: 1, pageCount: 1, from: 0, to: 0, total: 0 }`;
    - 50 items gives `pageCount 1`;
    - 51 items gives `pageCount 2`, and page 2 has 1 item with `from 51, to 51`;
    - page 3 of 51 items is clamped to 2;
    - page 0 is clamped to 1.
  - `chipRange` at `2026-10-17T19:35:00Z` (Dubai: 17 Oct, 23:35):
    - `last30.from` is `"2026-09-18"`;
    - `today.from` is `"2026-10-17"`;
    - `year.from` is `"2026-01-01"`;
    - `all.from` is `null`;
    - every `to` is `"2026-10-17"`.
  - `chipRange` at `2026-10-17T20:00:00Z` gives `today.from === "2026-10-18"` (Dubai midnight).
  - `chipIsServer`: `year` and `all` are true; `last30` and `today` are false.
  - `localHistoryRange` at the same instant has `from` `"2026-07-20"` and `to` `"2026-10-17"`.
  - `mergeUnsyncedSales`:
    - one server row and two unsynced sales (one matching "omar" in range, one not) give two rows, newest first, with the local one marked `local: true`;
    - an unsynced sale whose id is already among the server rows is not duplicated;
    - an unsynced sale dated before `range.from` is excluded.
- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/lists.test.mjs`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the four modules.
- [ ] **Step 4: Run** it again. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(lists): search, phone matching, paging, date chips and result merging`.

### Task 2: Sync status, toast queue and confirm queue (pure)

**Files:**
- Create: `lib/sync/status-text.ts`, `lib/ui/toast-store.ts`, `lib/ui/confirm-store.ts`
- Test: `tests/ui-state.test.mjs`

**Interfaces:**
- `syncStatus(input: { mode: "hosted" | "sample" | "unconfigured"; online: boolean; pending: number; needAttention: number; syncing: boolean }): { text: string; tone: "ok" | "busy" | "offline" | "attention" | "sample"; attention: boolean }`.
  - Precedence, highest first: sample, then attention, then offline, then syncing, then ok.
  - Texts exactly as in Global Constraints. `needAttention` counts failed operations: 1D product problems plus other failed ops.
- **Toasts:**
  - `type Toast = { id: string; message: string; tone?: "ok" | "info" }`
  - `pushToast(queue: Toast[], toast: Toast, max = 3): Toast[]` keeps the newest `max`.
  - Store API: `toast(message: string, tone?)`, `dismissToast(id)`, `subscribeToasts(listener)`, `getToasts()`. Auto-dismiss after 4000 ms lives in the store, using an injectable timer (`setTimer` parameter for tests).
- **Confirms:**
  - `type ConfirmRequest = { id: string; title: string; body: string; confirmLabel: string; destructive?: boolean; resolve: (ok: boolean) => void }`
  - `requestConfirm(options: Omit<ConfirmRequest, "id" | "resolve">): Promise<boolean>` queues a request.
  - `answerConfirm(id: string, ok: boolean)` resolves it and removes it.
  - `subscribeConfirms`, `getConfirms`.

- [ ] **Step 1: Write the failing tests:**
  - `syncStatus`:
    - online with 0 pending gives `Online · all synced`;
    - online with 120 pending and syncing gives `Syncing · 120 left`;
    - offline with 8 pending gives `Offline · 8 waiting`;
    - offline with 0 gives `Offline · all saved`;
    - 2 need attention (offline, 5 pending) gives `2 need attention` with `attention: true`;
    - sample mode gives `Sample shop · not synced`.
  - `pushToast`: 4 pushes keep the last 3.
  - The toast store with a fake timer auto-dismisses after 4000.
  - `requestConfirm` resolves `true` after `answerConfirm(id, true)` and `false` after `answerConfirm(id, false)`, and removes the request from `getConfirms()`.
- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/ui-state.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the three modules.
- [ ] **Step 4: Run** it again. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(ui): sync status text, toast and confirm queues`.

### Task 3: Shared UI parts, with confirms and toasts wired in

**Files:**
- Create: `components/ui/confirm-host.tsx`, `components/ui/toaster.tsx`, `components/ui/pager.tsx`, `components/ui/summary-strip.tsx`, `components/ui/empty-state.tsx`, `components/ui/skeleton.tsx`
- Modify:
  - `components/app-shell.tsx` (mount the hosts);
  - the six `window.confirm` call sites (spec §5.5);
  - `components/inventory-workspace.tsx`, `components/pos/held-carts.tsx`, `components/catalogue/import-dialog.tsx` and `components/register-workspace.tsx` (toasts);
  - `app/globals.css`.

**Interfaces:**
- `ConfirmHost()` renders the first queued request as a `role="alertdialog"` modal:
  - title, body, a Cancel button and the confirm button (red when `destructive`);
  - focus moves to Cancel for destructive requests and to Confirm otherwise; focus is trapped; Escape cancels; focus returns to the element that had it.
- `Toaster()` sits bottom-centre at ≤ 760px (above the bottom bars) and bottom-right otherwise. It uses `aria-live="polite"`, and each toast has a dismiss button.
- `Pager({ page, pageCount, from, to, total, onPage })` renders "‹ Previous", "`from`–`to` of `total`" (en-US grouping) and "Next ›"; the buttons are disabled at the ends.
- `SummaryStrip({ items: { label: string; value: string }[] })` is one line of 2–4 figures, wrapping on phones.
- `EmptyState({ icon, title, hint, action? })`.
- `Skeleton({ rows?: number; variant: "list" | "cards" | "grid" })`.
- **Replace each `window.confirm` with `await requestConfirm({...})`:**
  - sign out with unsynced changes (destructive);
  - more than 500 labels;
  - archive a product;
  - hold the current sale first;
  - discard a held sale (destructive);
  - restore a backup (destructive).

  Keep each message's meaning; the confirm labels are "Sign out", "Print", "Archive", "Hold and resume", "Discard" and "Restore".
- **Toasts:**
  - "Product saved" (add or edit), "Product archived", "Product restored";
  - "Sale held", "Sale resumed";
  - "Export ready", "Import finished: N products";
  - "Register opened", "Register closed".

- [ ] **Step 1: Verify in the browser** on the sample shop. These are UI parts; Task 2 tests their logic.
  - Archive a product: the dialog appears, Escape cancels, and the product stays. Archive again and confirm: the "Product archived" toast appears and disappears after about 4 s.
  - Hold a sale with a non-empty cart and resume another: the "Hold and resume" dialog appears.
  - Discard a held sale: the red "Discard" button has focus on Cancel.
  - Run `document.activeElement` checks for the focus trap and the return of focus.
  - Run `grep -rn "window.confirm" components app`. Expected: no matches.
- [ ] **Step 2: Run** `npm run lint`, `npm run typecheck` (run `npm run build` first in a fresh worktree) and `npm test`. Expected: all pass.
- [ ] **Step 3: Commit** with `feat(ui): in-app confirm dialog, toasts and shared list parts`.

### Task 4: Navigation (phone tabs, More sheet, user menu, top bar, sync status, branch name, cart sheet)

**Files:**
- Create: `components/nav/more-sheet.tsx`, `components/nav/user-menu.tsx`
- Modify:
  - `components/app-shell.tsx` and `components/offline-runtime.tsx`;
  - `app/api/v1/snapshot/route.ts`, `lib/snapshot/types.ts` and `lib/snapshot/map-rows.ts` (branch name);
  - `app/globals.css`.
- Test: `tests/snapshot-map.test.mjs`, with a branch name case added.

**Interfaces:**
- **`TillDevice`** gains `branchName: string`.
  - The snapshot devices query selects `id, name, till_number, branch_id, status, branch:branches(name)`.
  - `mapRows` sets `branchName: d.branch?.name ?? "Main branch"`.
- **Status hook:** `useSyncStatusText(): ReturnType<typeof syncStatus>`, in `components/offline-runtime.tsx`. It reads online state, pending/failed counts, `productSyncProblems` and the syncing state. Syncing state comes from a new store export, `isSyncing(): boolean`, plus a subscribe, set around `reconcilePendingOperations`.
- **`OfflineRuntime`** keeps auto-sync and the service worker, and renders nothing visible. Status display moves to `UserMenu` and `MoreSheet`.
- **`MoreSheet({ open, onClose })`:**
  - a header card: shop name, `Till N · branchName` (or "Sample shop"), email, and the status text with tone (a link when `attention`: to `/inventory` if product problems exist, otherwise `/settings?tab=data`);
  - links: Customers, Register, Reports, Settings;
  - Sign out or Leave sample;
  - `role="dialog"`, focus trap, Escape, backdrop close, focus return.
- **`UserMenu()`**, at the bottom of the desktop sidebar: a button showing `Till N · branchName` and the status line, which opens a menu with the email, Settings, and Sign out or Leave sample.
- **Phone bar** (≤ 760px): five items, Overview · Sales · New sale · Inventory · More.
  - New sale is the centre item with the class `.nav-primary`: filled, brand colour.
  - More is active when the path starts with `/customers`, `/register`, `/reports` or `/settings`.
- **Top bar:** shop name with ellipsis on the left; `Till N · branchName` and **New sale** on the right. No email and no Sign out there.
- **Cart sheet fix:** in the ≤ 760px block, `.cart-panel` gets `top: auto` (spec §5.8).

- [ ] **Step 1: Write the failing test.** In `tests/snapshot-map.test.mjs`, a device row with `branch: { name: "Deira" }` maps to `branchName: "Deira"`, and one without maps to `"Main branch"`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Verify in the browser** on the sample shop, at 375px, 820px and 1024px:
  - At 375px:
    - the bar has 5 items, New sale is highlighted, there's no horizontal scroll, and targets are 44px or more;
    - More opens the sheet; Escape closes it and focus returns to More;
    - on `/customers`, More shows as active;
    - on `/sale` with items, the cart bar sits above the bottom bar with no overlap, and the cart sheet's bottom edge is on the cart bar (`top` computed `auto`);
    - after a sale, the receipt sheet is fully visible.
  - At 761px, 820px and 1024px with a 60-character shop name: the top bar height equals a single row, with no wrap.
  - Desktop: the user menu opens, shows the email, and Sign out works through the confirm dialog.
- [ ] **Step 5: Run** `npm test`, `npm run lint` and `npm run typecheck`. Expected: pass.
- [ ] **Step 6: Commit** with `feat(nav): five-tab phone bar with More sheet, sidebar user menu and plain sync status`.

### Task 5: Server sales search (owner-only RPC and routes)

**Files:**
- Create: `supabase/migrations/202610190022_sales_search.sql`, `app/api/v1/sales/search/route.ts`, `app/api/v1/sales/[id]/route.ts`
- Modify: `lib/snapshot/map-rows.ts` (export `mapSaleRow`, used by the existing sales mapping), `supabase/tests/foundation_test.sql` (section 23)
- Test: `tests/snapshot-map.test.mjs` (the existing sales mapping still passes through `mapSaleRow`)

**Interfaces:**
- **`search_sales(p_business_id uuid, p_query text, p_from date, p_to date, p_limit integer, p_offset integer) returns table (id uuid, invoice_number text, customer_name text, customer_phone text, supply_date date, created_at timestamptz, payment_method text, gross_fils bigint, total_count bigint)`**
  - `security definer`, `search_path = public, extensions, pg_temp`.
  - Raises `not_authorized` (42501) unless `owns_business(p_business_id)`.
  - Matches when `p_query` is empty, or `invoice_number ilike '%q%'`, or `customer_snapshot->>'name' ilike '%q%'`, or (the query has at least 4 digits and the normalised `customer_snapshot->>'phone'` contains the normalised query digits).
  - The SQL phone normalisation mirrors `normalizePhone`: `regexp_replace(... '\D', '', 'g')`, then strip `^(00971|971)`, then `^0`.
  - Range: `p_from` is null or `supply_date >= p_from`, and `supply_date <= p_to`.
  - Order: `created_at desc, id`. `total_count` uses `count(*) over ()`.
  - `p_limit` is capped at 50.
- **Index:** `create index if not exists sales_business_supply_date_idx on public.sales (business_id, supply_date desc, created_at desc)`.
- **`get_sale_detail(p_business_id uuid, p_sale_id uuid) returns jsonb`**
  - owner-only, the same guard;
  - returns the sale row plus `sale_items` in the snapshot row shape, so the route can map it with `mapSaleRow`;
  - null when not found.
- **`GET /api/v1/sales/search?q=&from=&to=&page=`** returns `{ rows: SaleRow[]; total: number; page: number }`.
  - Validated with zod: `page` ≥ 1; `from`/`to` are `YYYY-MM-DD`; `q` has at most 100 characters.
  - The business comes from the active membership, as in the snapshot route. Returns 401 when signed out and 403 for `not_authorized`.
- **`GET /api/v1/sales/[id]`** returns `{ sale: Sale }`, or 404.

- [ ] **Step 1: Write the failing SQL tests** (section 23, before the final `rollback`):
  - Owner A:
    - `search_sales` with the query `T17` finds invoice `T17-1` (from section 17), and `total_count` is 1;
    - a phone search, given a sale with `customer_snapshot` phone `+971 55 555 0198` searched as `0555550198`, finds it;
    - an empty query with `p_from` after every sale returns 0 rows.
  - Owner B calling `search_sales` and `get_sale_detail` for business A raises `not_authorized`.
  - `get_sale_detail` for A's sale returns `invoice_number` `T17-1` and one item.
- [ ] **Step 2: Run** `supabase db reset` and `npm run test:sql`. Expected: FAIL at section 23 (the function does not exist).
- [ ] **Step 3: Implement** the migration, then refactor `mapSaleRow` out of `mapSnapshotRows` and add the two route handlers.
- [ ] **Step 4: Run** `supabase db reset`, `npm run test:sql`, `npm run test:rehearsal` and `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** with `feat(sales): owner-only server search for sales older than the local history`.

### Task 6: Sales page (search, chips, pages, strip, server results; view-only old invoices)

**Files:**
- Modify: `components/sales-workspace.tsx`, `components/invoice-detail-workspace.tsx`, `app/globals.css`

**Interfaces:**
- **URL state:** `/sales?q=&chip=last30|today|year|all&page=N`. The default `chip` is `last30`.
- **Local chips** (`!chipIsServer`): `store.sales` filtered by `saleMatches` and the chip range, newest first, then `paginate`.
- **Server chips:**
  - **Online:** fetch `/api/v1/sales/search`, debounced at about 300 ms. Rows come back with `mergeUnsyncedSales` applied, using the store's unsynced sale operations' sales; merging affects page 1 only. Show a skeleton while loading.
  - **Offline:** show the fixed message from Global Constraints, then use the local result list for `localHistoryRange(now)`.
  - A fetch error shows `Older sales could not be loaded. Showing the last 90 days.` with the same fall-back.
- **Compact strip:** gross, number of sales and average across **all** sales matching the search and chip, not just the current page. Server chips show only the match count (`total`), since the server returns one page.
- **Empty state:** `No sales match "q" in <chip label>`, with a **Search all dates** button setting `chip=all`.
- **Invoice page:** when the sale isn't in the store, fetch `/api/v1/sales/[id]` (online only).
  - Render the sale read-only, with Print 80mm and Print A4.
  - Show no refund button; show `Refunds are available for sales in the last 90 days.` instead.
  - Offline and not local: the existing "Invoice not found" text, plus "Connect to the internet to open older invoices."

- [ ] **Step 1: Verify in the browser** on a hosted local shop. Sales need the server, so use the Task 9 setup early, or seed at least 60 sales through the POS or SQL.
  - "omar" finds the matching sales; a phone in three formats finds the same sales.
  - 60 sales give 2 pages ("51–60 of 60").
  - `All` returns server rows, and an old invoice (SQL-dated more than 90 days back) opens read-only and prints.
  - With sync requests blocked (fetch stub) and `All`, the offline message shows with local rows.
  - A sale made while sync is blocked appears once under `All` after reconnecting.
- [ ] **Step 2: Run** `npm run lint` and `npm run typecheck`. Expected: pass.
- [ ] **Step 3: Commit** with `feat(sales): search by invoice, name or phone, date chips, pages of 50 and old invoices from the server`.

### Task 7: Customers, Inventory and Reports lists

**Files:**
- Modify: `components/customers-workspace.tsx`, `components/inventory-workspace.tsx`, `components/reports-workspace.tsx`, `app/globals.css`

**Interfaces:**
- **Customers:** `?q=&page=`; `customerMatches`; pages of 50; a compact strip of customers count and new this month; the empty state.
- **Inventory:**
  - `?q=&status=active|archived&page=`; pages of 50.
  - "Select all shown" selects the **current page** only; the label button shows the selected count (spec §5.8).
  - A compact strip of product count and low stock.
  - Archiving the last row of the last page steps back a page (`paginate` clamps).
- **Reports:** the large metric cards become a `SummaryStrip`; nothing else changes (owner's decision).

- [ ] **Step 1: Verify in the browser:**
  - Inventory with 120 products: 3 pages; the search narrows; select-all marks 50.
  - Customers: phone-format search.
  - Reports: the strip shows the same totals as before.
  - At 375px: no horizontal scroll.
- [ ] **Step 2: Run** `npm run lint`, `npm run typecheck` and `npm test`. Expected: pass.
- [ ] **Step 3: Commit** with `feat(lists): search and pages of 50 on Customers and Inventory; compact strip on Reports`.

### Task 8: Skeletons, empty states and Settings tabs

**Files:**
- Modify: `components/auth-gate.tsx` (or wherever the hosted loading state renders), `app/(dashboard)/overview/page.tsx`, `components/pos-workspace.tsx`, `app/(dashboard)/settings/page.tsx`, `app/globals.css`

**Interfaces:**
- **Skeletons** show while the hosted store has neither a cache nor its first snapshot: `Skeleton variant="list"` on list pages, `"cards"` on Overview and `"grid"` for the POS product grid.
- **Every list** uses `EmptyState`.
- **Settings tabs:** `?tab=business|tills|tax|data`, default `business`.
  - **Business:** shop identity, without the prefix and footer.
  - **Tills:** a read-only table of `devices` (till number, name, branch, status, "This browser" marker) and a **Switch this browser's till** link to the existing till picker flow.
  - **Tax and invoices:** invoice prefix and receipt footer, as today.
  - **Data:** sync now, the offline outbox, backup and restore, the cloud catalogue (sample only), and the details of failed operations.
  - The tab row scrolls sideways within itself on phones.

- [ ] **Step 1: Verify in the browser:**
  - Throttle the snapshot (fetch stub with a delay) on a cold hosted load: skeletons show, with no layout jump.
  - Each Settings tab loads from the URL and survives a refresh.
  - At 375px: the tab row scrolls inside itself, and the page has no horizontal scroll.
- [ ] **Step 2: Run** `npm run lint`, `npm run typecheck` and `npm test`. Expected: pass.
- [ ] **Step 3: Commit** with `feat(ui): loading skeletons, consistent empty states and Settings tabs`.

### Task 9: End-to-end smoke on local Supabase, and the full suite

**Files:** none, unless a defect is found. Each fix gets a failing test (or a browser RED) first and a `fix:` commit.

- [ ] **Step 1: Setup.**
  - `supabase db reset`;
  - create the local owner, with credentials in the git-ignored `.env.local` only;
  - start the dev server on 3101;
  - clear only `sb-127-*` cookies and the 3101 origin's storage;
  - set up the shop, choose the till and open the register;
  - import 120 products (1D import);
  - make 60 sales, 5 of them to "Omar Hassan" (`+971 55 555 0198`);
  - via SQL, backdate 10 sales to 2025 (more than 90 days).
- [ ] **Step 2: Run these checks and record each result.**
  1. **Phone at 375px:** 5 tabs; More holds the right links, the status and Sign out; no horizontal scroll; targets 44px or more.
  2. **POS on a phone:** the cart bar sits above the bottom bar; the cart sheet sits on the cart bar; the receipt sheet is fully visible.
  3. **Desktop at 761, 820 and 1024px with a long shop name:** the top bar is one row; the user menu works; Sign out goes through the confirm dialog.
  4. **Sales:**
     - "omar" and the phone in three formats give 5 results;
     - 60 sales show as "1–50 of 60", then "51–60 of 60";
     - `All` includes the 10 backdated sales, and one of them opens read-only with no refund button and prints.
  5. **Offline `All`:** shows the fixed message plus local rows. A sale made offline appears once under `All` after reconnecting.
  6. **Sync status texts:** synced, syncing, offline waiting, and need attention (a 1D barcode clash) with its link.
  7. **Confirms and toasts:** every former `window.confirm` path is now a dialog; the toasts appear.
  8. **Customers and Inventory:** search and pages; inventory select-all marks the current page.
  9. **Settings:** the tabs and their URLs.
- [ ] **Step 3: Run** `npm test`, `npm run test:sql`, `npm run test:rehearsal`, `npm run lint`, `npm run typecheck` and `npm run build`. Expected: all pass. Record `1E smoke passed`.
