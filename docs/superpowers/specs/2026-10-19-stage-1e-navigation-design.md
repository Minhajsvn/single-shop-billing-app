# Stage 1E: Navigation and polish — design

Parent spec: `docs/superpowers/specs/2026-10-11-saas-plans-and-improvements-design.md` (§4 Layout and navigation, Polish; §5 Stage 1 items 6 and 10).
Sub-plan table: `docs/superpowers/plans/2026-10-11-stage-1-starter-launch.md` (row 1E).
Builds on 1B (hosted store, snapshot), 1C (POS), 1D (catalogue, inventory page).

## 1. Intent

Two things annoy owners and cashiers most today (owner's words): **finding a page** and **finding an old sale or customer**.

- On a phone, all eight pages are squeezed into one bottom bar.
- The Sales and Customers lists have no search or paging.
- The 5,000-product Inventory table renders every row.

1E fixes those first. It then cleans up the rest of the frame:
- the user menu;
- plain sync status;
- slimmer summary cards;
- proper dialogs and toasts in place of browser pop-ups;
- loading skeletons;
- Settings split into tabs.

**Success:**
- On a phone, a cashier reaches New sale, Sales or Inventory in one tap and anything else in two.
- An owner finds a sale by typing an invoice number, a customer name or a phone number, whether the sale was this morning or last year.
- No list ever renders thousands of rows.

## 2. Decisions taken with the owner

| Topic | Decision |
|---|---|
| Biggest pains | Finding a page; finding an old sale or customer. |
| Finding a sale | By **invoice number**, or **customer name or phone**. |
| Most-used pages on a phone | **New sale, Sales, Inventory**. Everything else can sit under **More**. |
| Phone bottom bar | Mockup B, five tabs: **Overview · Sales · New sale (centre, highlighted) · Inventory · More**. This overrides the parent spec's "4 tabs plus More". |
| More sheet | Customers, Register, Reports, Settings, plus the till, the account, sync status and Sign out. |
| Long lists | Mockup A: **pages of 50 with Previous / Next** and a "51–100 of 1,240" position. |
| Date chips on Sales | **Keep**: Last 30 days (default) · Today · This year · All. |
| Sales older than the browser's history | **Search them on the server** (needs internet). The browser holds only the last 90 days (`HISTORY_DAYS` in `app/api/v1/snapshot/route.ts`). |
| The rest of the playback (§5) | Approved as described ("all fine"). |
| Reports | **Keep the one-day report** (date picker, ledger, CSV, print, register check) plus the compact strip; no period chips in 1E. |
| Old sales found through server search | **View and reprint only**; refunds stay limited to sales the browser holds (last 90 days). |

## 3. Goals

1. A five-tab phone navigation with a More sheet; on desktop, a sidebar user menu and a top bar that never wraps.
2. Search and pages of 50 on **Sales**, **Customers** and **Inventory**:
   - Sales adds date chips, and searches the server for periods beyond 90 days.
   - Reports keeps its one-day picker (owner's decision).
3. Plain sync status text everywhere it appears.
4. Compact summary strip in place of the large summary cards on list pages.
5. In-app confirmation dialogs (no `window.confirm`) and toasts for short confirmations.
6. Skeleton loading states and consistent empty states.
7. Settings split into tabs.
8. Carry-overs from 1C and 1D:
   - the phone cart sheet sits on the cart bar instead of hanging from the top;
   - the inventory list is paginated.

## 4. Non-goals

- The onboarding checklist (1G), billing UI (1F), staff/roles (Stage 2), and Arabic/RTL (Stage 3).
- New report types or period reports. Reports keeps its one-day report and only gains the compact strip.
- Refunds on sales older than the browser's 90-day history.
- Server-side search for Customers or Inventory: both are fully held in the browser.
- Infinite scroll, column sorting and saved filters.

## 5. How it works

### 5.1 Navigation

**Phone (≤ 760px, the app's existing mobile breakpoint).**
- Bottom bar with five items: **Overview · Sales · New sale · Inventory · More**.
  - New sale is the centre item, visually highlighted: filled, in the brand colour.
  - The active tab is marked.
  - Tap targets are at least 44px; the bar sits above the safe-area inset.
  - The 1C POS cart bar still sits directly above the bottom bar.
- **More** opens a bottom sheet:
  - a header card with the shop name, "Till N · branch", the signed-in email (or "Sample shop") and the sync status line (§5.3);
  - links to Customers, Register, Reports and Settings;
  - **Sign out**, or **Leave sample** in sample mode.
  - It closes on a link tap, a backdrop tap or Escape.
  - When the current page is one of the More pages, the More tab shows as active.

**Desktop (> 760px).**
- **Sidebar.** The links stay as today. The bottom of the sidebar becomes a **user menu button** showing "Till N · branch" and the sync status line. It opens a small menu with the email, Settings and Sign out (or Leave sample).
- **Top bar.** Shop name on the left; on the right "Till N · branch" and the **New sale** button. The email and Sign out move to the user menu. The top bar must not wrap at any width above 760px; long shop names are cut off with an ellipsis.

**Branch name.** Starter has one branch. Show the device's branch name if the snapshot provides it, otherwise "Main branch". *Builder: check what `TillDevice`/snapshot exposes and add the branch name to the snapshot if it is missing.*

### 5.2 Lists: search and pages of 50

One shared pattern for Sales, Customers and Inventory: a search box, optional chips, the list, and a pager.

- **Search box.** Results narrow as you type, with a short debounce. Matching is case-insensitive and on substrings.
  - **Sales:** invoice number; customer name; customer phone. Phone matching ignores spaces, dashes and a leading `+971`/`0`, so `0555550198`, `+971 55 555 0198` and `55 555 0198` all match.
  - **Customers:** name or phone, with the same phone matching. Also TRN and email, which the list shows anyway.
  - **Inventory:** as today, name, SKU or barcode.
- **Pager.** 50 rows per page; "‹ Previous", "51–100 of 1,240", "Next ›". Changing the search or a chip returns to page 1. *Your call: keep page, query and chip in the URL query string so Back and refresh keep the place.*
- **Sales date chips.** **Last 30 days** (default) · Today · This year · All. Dates are Dubai business dates, using the existing `dubaiSupplyDate`.
  - **Today** and **Last 30 days** fall within the 90-day history the browser holds, so they are searched locally and work offline.
  - **This year** and **All** reach beyond 90 days, so they query the server.
    - The server search returns the same row shape (invoice, customer, date, total, payment method), 50 per page, newest first.
    - Unsynced local sales are merged into the results, so a sale made offline today still appears under "All".
    - **Offline**, these chips show a clear message: "Older sales can be searched when this device is online. Showing the last 90 days." The list falls back to the local 90 days. It never shows a misleading "No sales found".
  - *Builder:* the server search is a new authenticated, business-scoped endpoint (or RPC), owner and member only. It searches the invoice number, `customer_snapshot` name and phone, and the date range. Add an index if needed for a few hundred thousand sales.
  - **Opening a sale from server results is view and reprint only** (owner's decision). The invoice page shows the fetched sale with Print 80mm and Print A4. It shows no refund action for sales not held locally; it says "Refunds are available for sales in the last 90 days." The fetched sale is not added to the local store.
  - **Access** *(designer call: §9)*. The server search is for **owners only**, matching today's RLS (`sales` is readable by `owns_business`). Starter has one user; staff roles arrive in Stage 2.
- **Reports** keeps its one-day report (owner's decision). It gains only the compact strip (§5.4).
- **Empty states.** "No sales match 'omar' in the last 30 days" with a "Search all dates" button. "No customers yet" or "No products yet", each with its primary action.

### 5.3 Sync status text

One short status phrase, shown in the desktop sidebar user button and the phone More sheet header:

| State | Text |
|---|---|
| Online, nothing pending | **Online · all synced** |
| Online, sending | **Syncing · N left** |
| Offline | **Offline · N waiting** (or **Offline · all saved** when N = 0) |
| Refused operations (1D `productSyncProblems` and other failed ops) | **N need attention**, linking to the place that explains them (Inventory for products; Settings → Data for others) |
| Sample mode | **Sample shop · not synced** |

This replaces "Device ready · local cache" and "N pending · syncing when available" from `components/offline-runtime.tsx`.

### 5.4 Compact summary strip

The large metric cards on **Sales**, **Customers**, **Inventory** and **Reports** become one slim line of 2–4 figures. For example:
- "Today AED 1,240.00 · 38 sales · Avg AED 32.60"
- "412 customers · 9 new this month"
- "5,000 products · 23 low stock"

The strip reflects the current chip or period where one applies. It wraps to two lines on phones rather than scrolling sideways. **Overview** and **Register** keep their cards: they are dashboards, not lists.

### 5.5 Dialogs and toasts

- **Confirm dialog.** One reusable, accessible dialog (`role="alertdialog"`, focus trapped, Escape cancels, Enter confirms the safe default) replaces every `window.confirm`. Today these are:
  - sign out with unsynced changes (`components/app-shell.tsx`);
  - print more than 500 labels (`components/catalogue/label-print-dialog.tsx`);
  - archive a product (`components/inventory-workspace.tsx`);
  - hold the current sale first, and discard a held sale (`components/pos/held-carts.tsx`);
  - restore a backup (`app/(dashboard)/settings/page.tsx`).

  Destructive actions (discard, restore, sign out with unsynced work) use a red confirm button and name the consequence.
- **Toasts** are for short confirmations of things that just happened: product saved or archived, sale held or resumed, export ready, import finished, register opened. They appear bottom-centre on phones, above the bars, and bottom-right on desktop. They disappear after about 4 seconds and are announced politely to screen readers. At most 3 show at once.
- **Errors that need action never appear only as a toast.** They stay on the page, as today's form errors and notices do.

### 5.6 Loading and empty states

- **Skeletons** replace blank or jumping content while the hosted shop loads: before `startHostedStore` settles, or before the first snapshot when there is no cache. They cover the list pages, Overview and the POS product grid. They are grey placeholder rows and cards in the final layout's shape.
- **Empty states** use one shared component: icon, one-line title, one-line hint, optional primary action. Use it wherever a list can be empty.

### 5.7 Settings tabs

Settings splits into tabs: **Business · Tills · Tax and invoices · Data**.
- **Business:** legal name, TRN, address, phone, and the business settings that exist today.
- **Tills** *(designer call: §9)*: a read-only list of this browser's till and the business's other tills (from the snapshot devices), with a link to the existing till picker to switch this browser's till. No renaming in 1E.
- **Tax and invoices:** invoice prefix and receipt footer, as they exist today. No new settings.
- **Data:** sync now, backup and restore, and any "N need attention" details.

The owner decided to **hide** Staff and Billing until they exist (Billing arrives in 1F). Tabs are links (`/settings?tab=tills`) so they survive refresh and Back. On phones the tab row scrolls sideways inside itself, never the page.

### 5.8 Carry-overs

- **Phone cart sheet (1C minor).**
  - The ≤ 900px rule sets `.cart-panel { top: 16px }`, and the ≤ 760px sheet never resets it, so the sheet hangs from the top of the screen.
  - Add `top: auto` so the sheet sits on the cart bar, above the new bottom bar.
  - Re-check that the receipt panel, also a sheet on phones, stays usable.
- **Inventory paging (1D).** Covered by §5.2. Selecting "all shown products" for labels applies to the current page only; the label button shows the count.

## 6. Constraints

- Follow `AGENTS.md`: this Next.js version differs from training data, so read `node_modules/next/dist/docs/` before using routing or search-param APIs.
- No new runtime dependencies for dialogs, toasts or skeletons; build them on the existing CSS and components.
- Phone layouts at 375px wide must have no horizontal page scroll and 44px touch targets. Desktop at 1024px and above must not wrap the top bar.
- ESLint React-compiler rules (no synchronous setState in effects, no ref reads during render); hydration-safe (anything read from `localStorage`/`window` loads after mount).
- Pure logic goes in modules with relative `.ts` imports and Node tests: search matching, phone normalisation, paging maths, date-chip ranges and status-text selection.
- Any server search endpoint is authenticated and business-scoped, has tests, and never exposes another business's sales. Migrations: new files only, SQL tests added, local Supabase only, never pushed to hosted.

## 7. Left to the builder

- Component structure, CSS naming, debounce timing, toast animation.
- Whether search state lives in the URL (recommended) or in component state.
- Whether the server sales search is a Next route handler or a Supabase RPC.
- The exact figures in each compact strip, within §5.4.

## 8. Review focus (likely to bite)

1. **Phone matching:** `+971 55 555 0198`, `0555550198` and `55-555-0198` must all find the same customer and their sales.
2. **Offline with "All dates":** a clear message and a fall-back to 90 days, never an empty "no results".
3. **A sale made offline today:** appears in local results and in "All" server results once online, without duplicates.
4. **Page boundaries:**
   - exactly 50 results shows one page;
   - 51 shows two;
   - when deleting or archiving the last item on page 3 leaves it empty, step back to page 2.
5. **The More sheet and the dialog:** keyboard and screen reader (focus trap, Escape, focus restored to the opener).
6. **No top-bar wrapping at 761–1024px;** the phone bottom bar never overlaps the POS cart bar or the receipt sheet.

## 9. Calls made by the designer (not the owner); check these

- **Owners only** may search old sales on the server, matching today's database rules. This can be widened to staff in Stage 2.
- **The Tills tab is read-only**, plus the existing switch-till flow. Rename or re-register are left for later.
- **Tax and invoices tab:** only the settings that already exist (invoice prefix, receipt footer). The earlier "VAT display" mention was dropped, because no such setting exists.
- **Hidden tabs:** Staff and Billing are hidden, not shown as "coming soon".
- **Search state in the URL:** recommended, so Back and refresh keep the page, query and chip.
- **Errors that need action** stay on the page; toasts are only for confirmations.
