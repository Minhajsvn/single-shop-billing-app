# Stage 2E Promotions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner/manager-defined promotions (percent, AED off, buy N get M, N for P, basket %; with dates, days, hours) applied automatically by every till, online or offline, and recorded per sale line.

**Architecture:** One migration adds `promotions` (members read live rows, writes via RPC), promotion fields on `sale_items` stored by the sale wrapper, and a results function. A pure engine `lib/promotions/engine.ts` prices the cart on the till from the snapshot's promotions; the POS keeps list prices and manual discounts in its cart state and shows/sends the engine's priced lines. A `/promotions` page manages and reports.

**Tech Stack:** Next.js 16 app router (read `node_modules/next/dist/docs/` before routes/pages), Supabase Postgres, zod, `node --test --experimental-strip-types`, `npm run test:sql`.

**Spec:** `docs/superpowers/specs/2026-11-12-stage-2e-promotions-design.md`

## Global Constraints

- Feature key `promotions` (Pro). Manage: owner and manager. Cashiers only see promotions applied.
- Every priced line: `gross = unitGrossFils × quantity`, `unitGrossFils ≥ 1`; at most two output lines per cart line.
- Stacking: one item offer per line (largest saving; tie → earlier `createdAt`), then the best qualifying basket offer on top; a line with a manual discount (`listUnitGrossFils` set by the discount dialog) takes no item offer but does take the basket offer.
- Time: Dubai (`Asia/Dubai`) date, ISO weekday 1–7 (Mon=1), and time; windows may cross midnight.
- Save rules: name 1–40; percent 0.1–99; amount 1–100000 fils; `multi_buy_free` buy 1–99 & get 1–99; `multi_buy_price` buy 2–99 & bundle price > 0; basket threshold 0–10000000 fils with target `all`; `ends_on ≥ starts_on`; times both or neither.
- Migration `202611120059_promotions.sql` (replaces the 056 sale wrapper, keeping cost stamping and split-cash movement). Never edit 001–058.
- Refusals: `not_authorized` (42501), `feature_not_in_plan`, `invalid_promotion`, `target_not_found`, `invalid_range`.
- Snapshot refresh: every 5 minutes while online and on window focus; saving a promotion refreshes at once.
- Copy: "Promotions −AED x", "You saved AED x", "{name} · −AED x", Starter card "Run automatic offers at the till on Pro".
- Local Supabase only; browser checks on a worktree port with a temporary launch entry, bundle checked for `127.0.0.1:54321` before sign-in. Node tests use relative `.ts` imports; lint zero warnings.

## Review Focus

1. **Buy 2 get 1 on 4 units** → one group of 3 discounted, the 4th at list price; totals exact (Task 2 test `multi-buy remainder pays list`).
2. **A saving that doesn't divide evenly** (e.g. 20.00 over 3) → two lines 2 × 6.67 + 1 × 6.66, gross sums to 20.00 (Task 2 test `split keeps whole fils`).
3. **Happy hour Fri 22:00–02:00 at Sat 01:00 Dubai** → still live (window crossing midnight belongs to the start day) (Task 2 test `window crossing midnight`).
4. **A held cart brought back after the window ended** → priced without the offer (Task 4 POS step re-prices; Task 2 test `pricing depends on now only`).
5. **A line with a manual discount in a basket-offer bill** → no item offer, but its share of the basket saving (Task 2 test `manual line keeps basket`).

---

### Task 1: Promotions migration (059)

**Files:** Create `supabase/migrations/202611120059_promotions.sql`, `supabase/tests/promotions_test.sql`.

**Interfaces — Produces:** table `promotions` (spec §4 columns, `created_at`); `promotions_check(p_business_id)` (owner/manager + `promotions`, revoked from members); `promotion_save(p_business_id uuid, p_promotion jsonb) returns uuid` with payload keys `id, name, kind, targetType, targetId, percent, amountFils, buyQty, getQty, bundlePriceFils, minBasketFils, startsOn, endsOn, days, fromTime, toTime, active, archived`; `promotion_list(p_business_id) returns jsonb` (array, same keys plus `createdAt`); `promotion_results(p_business_id, p_from date, p_to date) returns jsonb` (array of `{ promotionId, name, uses, units, netFils, savingFils, costFils, profitFils }`, cost/profit null when no line has cost); `sale_items.promotion_id uuid`, `sale_items.promotion_saving_fils bigint check (>= 0)`; replaced `apply_sale_sync_with_payments` copying `promotionId`/`promotionSavingFils` from payload lines (matched by line `id`).

- [ ] **Step 1: Failing SQL tests** (fixture: Pro shop A with manager and cashier, Starter shop B, category Drinks, product Cola):
  - 1a owner saves each kind once with valid fields → `promotion_list` returns 5 with camelCase keys.
  - 1b each rule violation (percent 0 and 99.5; amount 0; buy 0; `multi_buy_price` buy 1; basket with target `product`; ends before starts; only `fromTime`; name 41 chars) → `invalid_promotion`.
  - 1c another shop's product/category as target → `target_not_found`.
  - 1d manager saves; cashier → 42501; Starter → `feature_not_in_plan`.
  - 1e cashier `select id, name from promotions` returns live rows only: archived and ended (`ends_on` < Dubai today − 1) are hidden; cashier insert → `insufficient_privilege`.
  - 1f a synced sale (through `apply_sale_sync_with_payments`, register open) whose line carries `promotionId` and `promotionSavingFils: 300` stores both; a line without them stores nulls; cost stamping still works.
  - 1g `promotion_results` for today: `uses 1, units` = the line quantity, `savingFils 300`; 93-day range → `invalid_range`.
- [ ] **Step 2:** `npm run test:sql` → FAIL.
- [ ] **Step 3:** Write 059. RLS select policy `has_role(business_id,'cashier') and archived_at is null and (ends_on is null or ends_on >= (now() at time zone 'Asia/Dubai')::date - 1)`; revoke insert/update/delete; grant select. Column `days smallint[]` check each 1–7. Recreate the wrapper from 056's body and add, after cost stamping: `update sale_items i set promotion_id = (l->>'promotionId')::uuid, promotion_saving_fils = (l->>'promotionSavingFils')::bigint from jsonb_array_elements(p_payload->'sale'->'lines') l where i.sale_id = saved.id and i.id = (l->>'id')::uuid and l ? 'promotionId'` (validate uuid/integer ≥ 0 first; bad values ignored). Grant select on the two new `sale_items` columns to `authenticated` (2C column grants).
- [ ] **Step 4:** apply locally; `npm run test:sql` → all PASS.
- [ ] **Step 5:** commit `feat(2e): promotions table, save and results`.

### Task 2: Pricing engine

**Files:** Create `lib/promotions/types.ts`, `lib/promotions/engine.ts`, `lib/promotions/live.ts`; Test `tests/promotions-engine.test.mjs`.

**Interfaces — Produces:**
- `types.ts`: `Promotion = { id; name; kind: "percent_off" | "amount_off" | "multi_buy_free" | "multi_buy_price" | "basket_percent"; targetType: "product" | "category" | "all"; targetId: string | null; percent: number | null; amountFils: number | null; buyQty: number | null; getQty: number | null; bundlePriceFils: number | null; minBasketFils: number | null; startsOn: string; endsOn: string | null; days: number[] | null; fromTime: string | null; toTime: string | null; active: boolean; archived: boolean; createdAt: string }`.
- `live.ts`: `isLive(p: Promotion, now: Date): boolean` (Dubai; a window crossing midnight counts the start day's weekday for the after-midnight part).
- `engine.ts`: `type CartInput = { key: string; productId?: string; categoryId?: string | null; name: string; sku?: string; quantity: number; listUnitGrossFils: number; manualUnitGrossFils?: number }`; `type PricedLine = { key: string; productId?; name; sku?; quantity: number; unitGrossFils: number; listUnitGrossFils: number; promotionId?: string; promotionName?: string; promotionSavingFils: number; manual: boolean }`; `applyPromotions(cart: CartInput[], promotions: Promotion[], now: Date): { lines: PricedLine[]; savingFils: number }`; `splitWholeFils(totalFils: number, quantity: number): { quantity: number; unitGrossFils: number }[]`.

- [ ] **Step 1: Failing tests** (Cola 6.00 in Drinks; Dates 32.00):
  - `percent off`: 10% Drinks on 2 Cola → unit 5.40, saving 1.20.
  - `amount off never below 1 fils`: AED 10 off a 6.00 item → unit 0.01.
  - `best offer wins` (10% Drinks vs buy 2 get 1 Cola on 3 Cola) → multi-buy (saving 6.00 vs 1.80); `tie goes to the older` by `createdAt`.
  - `multi-buy remainder pays list`: buy 2 get 1 on 4 Cola → 3 units total 12.00 + 1 at 6.00 → total 18.00, saving 6.00.
  - `buy 2 get 1 on 6` → total 24.00. `3 for AED 10` on 4 Cola → 10.00 + 6.00.
  - `split keeps whole fils`: `splitWholeFils(2000, 3)` → `[{quantity:1,unitGrossFils:668},{quantity:2,unitGrossFils:666}]` (sum 2000; extra fils on the first part); every engine output line has unit ≥ 1 and gross = unit × qty.
  - `basket below threshold` (5% over 200.00 on 150.00) → none; `at threshold` 200.00 → saving 10.00 spread proportionally; `on top of item offers` uses the bill after item savings.
  - `manual line keeps basket`: a line with `manualUnitGrossFils` gets no item offer but its basket share.
  - `window crossing midnight`: Fri 22:00–02:00 live at Fri 23:00 and Sat 01:00 Dubai, not at Sat 03:00 or Thu 23:00; `days` Friday only live on Friday; out-of-dates, inactive, archived ignored.
  - `pricing depends on now only`: same cart, offer live at t1 and not at t2 → different results.
  - `category offer ignores archived category` (product's category not live → no match).
- [ ] **Step 2:** FAIL. **Step 3:** implement per spec §5 (largest-remainder spreading for multi-buy groups and the basket; then `splitWholeFils` per line). **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(2e): promotion pricing engine`.

### Task 3: Snapshot, sale records and sync payload

**Files:** Modify `lib/domain.ts` (`InvoiceLine` gains `promotionId?`, `promotionName?`, `promotionSavingFils?`; `DemoState.promotions: Promotion[]`), `lib/demo-store.ts` (`CheckoutLine` gains the same three; `completeSale` copies them onto lines; `normalizeState`, `emptyShopState`, cache parsing default `promotions: []`), `lib/sync/request-schema.ts` (sale line `promotionId: uuid().optional()`, `promotionSavingFils: int ≥ 0 optional`), `app/api/v1/snapshot/route.ts` + `lib/snapshot/{types,map-rows}.ts` (live promotions for every member, mapped to `Promotion`; sale_items select adds `promotion_id, promotion_saving_fils`), `lib/snapshot/merge.ts` (server promotions win). Test: additions to `tests/snapshot-map.test.mjs`, `tests/sync-request.test.mjs`, `tests/categories.test.mjs`-style normalize test in `tests/promotions-engine.test.mjs`.

- [ ] **Step 1: Failing tests:** snapshot rows with one promotion map to the `Promotion` shape (numeric fields as numbers, `days` array or null); sale line with promotion fields maps through; request schema accepts a line with `promotionId` + `promotionSavingFils: 300` and rejects `-1`; state saved before 2E normalizes to `promotions: []`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** `npm test` PASS, `tsc` clean.
- [ ] **Step 5:** commit `feat(2e): promotions in the snapshot and on sale lines`.

### Task 4: Till pricing and receipt

**Files:** Modify `components/pos-workspace.tsx`, `components/pos/receipt-panel.tsx`, the invoice document component (the one rendering sale lines on A4), `lib/checkout/held-carts.ts` (held lines keep list price and manual price only), `lib/reporting.ts` (daily report `promotionSavingFils` from lines), `components/reports-workspace.tsx` (Daily totals "Promotions saving"), `app/globals.css`, `lib/demo-store.ts` (5-minute + focus snapshot refresh while online).

**Interfaces — Consumes:** Task 2 `applyPromotions`, Task 3 `DemoState.promotions`, `CheckoutLine` promotion fields; `useEntitlement().hasFeature("promotions")`.

- [ ] **Step 1:** POS keeps cart state as `CartInput` (list price; `manualUnitGrossFils` from the discount dialog; `categoryId` from the product). `priced = hasFeature("promotions") ? applyPromotions(cart, store.promotions, now) : identity` is computed with `useMemo` on cart, promotions and a `now` that ticks every 30 s; the cart list, totals and `completeSale` use `priced.lines` (re-priced with `new Date()` at completion). Each priced line with a promotion shows "{name} · −AED x"; totals show "Promotions −AED x" when > 0.
- [ ] **Step 2:** Receipt panel and A4 invoice: per line, list price struck through and the promotion name when `promotionId`; footer "You saved AED x" when the sale's promotion + manual savings > 0.
- [ ] **Step 3:** Held carts store `CartInput` fields; bringing one back re-prices (Review Focus 4).
- [ ] **Step 4:** Daily report: `promotionSavingFils` = sum of that day's sale lines' `promotionSavingFils` (refunds do not reduce it: a refund returns the charged price, not the saving); label "Promotions saving". Unit test in the existing reporting test file: a day with one promo line of saving 300 → 300.
- [ ] **Step 5:** `lib/demo-store.ts`: while hosted and `navigator.onLine`, `refreshSnapshot()` every 5 minutes and on `visibilitychange` to visible; cleared on sign-out. Unit-test the scheduler helper `shouldRefresh(lastAt: number, now: number): boolean` (≥ 300000 ms).
- [ ] **Step 6:** `npm test`, `tsc`, lint → clean; commit `feat(2e): promotions at the till and on receipts`.

### Task 5: Promotions page, results and API

**Files:** Create `lib/promotions/{client,errors,route,describe}.ts`, `app/api/v1/promotions/route.ts` (GET list, PUT save), `app/api/v1/promotions/results/route.ts` (GET `?from&to`), `app/(dashboard)/promotions/page.tsx`, `components/promotions/{promotions-workspace,promotion-form}.tsx`; modify `lib/access/cashier.ts` (`/promotions` in `MANAGER_PAGES`; nav "Promotions" after Purchases for owner and manager), `components/nav/nav-icons.ts` (Tag icon), `tests/cashier-access.test.mjs`. Test `tests/promotions-client.test.mjs`.

**Interfaces — Produces:** `describePromotion(p: Promotion, targetName: string): string` (e.g. "Buy 2 get 1 free on Cola 330ml · 1–30 Nov · Fri 16:00–19:00"; "10% off Drinks · from 1 Nov"; "5% off bills of AED 200 or more · every day"); client `listPromotions()`, `savePromotion(p)`, `promotionResults(from, to)` returning `{ ok, … } | { ok: false, error, offline? }`; messages for each refusal code.

- [ ] **Step 1: Failing tests:** `describePromotion` for each kind incl. days and hours; client posts/puts JSON and maps refusals; offline text "Promotions need a connection"; access: manager and owner may open `/promotions`, cashier may not; nav order owner/manager.
- [ ] **Step 2:** FAIL. **Step 3:** implement routes (zod per Global Constraints, `staffSession`, `purchasingRpcFailure`-style mapping in `lib/promotions/route.ts`), page (tabs Active now / Scheduled / Ended / Archived from `isLive` and dates; live switch → `savePromotion({ ...p, active })`; archive), form (kind-specific fields, target picker: product search, category select, everything; days checkboxes; time inputs; preview from `describePromotion`), Results tab (period chips, table, CSV via `safeCsv`); Starter card copy; after a save call `refreshSnapshot()`. **Step 4:** PASS; `tsc` + lint clean.
- [ ] **Step 5:** commit `feat(2e): promotions page and results`.

### Task 6: Release notes and verification

**Files:** Modify `docs/RELEASE_CHECKLIST.md`; create `docs/superpowers/plans/2026-11-12-stage-2e-ledger.md`.

- [ ] **Step 1:** Checklist "Stage 2E": apply 059 (safe before the app); deploy after 059; smoke test each kind at the till online and offline, receipt "You saved", refund at the charged price, results, Starter card; support note: tills pick up changes within ~5 minutes or on focus.
- [ ] **Step 2:** `npm test`, `npm run test:sql`, lint, typecheck (known `PageProps` only), build → pass.
- [ ] **Step 3:** Browser pass per spec §9 on a worktree dev server.
- [ ] **Step 4:** Ledger and commit `docs(2e): release checklist and ledger`.
