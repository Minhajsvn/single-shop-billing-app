# Stage 2E: Promotions — design

Date: 2026-11-12. Fifth sub-project of Stage 2 (Pro tier). Order: 2A staff and PINs → 2B split payment → 2C categories
and margin → 2D suppliers and deliveries (all merged) → **2E** → 2F weighed items → 2G serial/IMEI → 2H advanced
reports → 2I digital receipts.

## 1. Goal

An owner or manager sets up offers once, and every till applies them on its own, online or offline, so cashiers never
work out a discount by hand. Receipts and tax invoices show what each customer saved, and the owner can see what each
promotion sold and cost.

Success:
- "Buy 2 get 1 free on Cola" set up once is applied at every till within 5 minutes, including one that then goes offline.
- A receipt shows the list price, the promotion and the price charged on each line, and "You saved AED X".
- Every sale line still has gross = unit price × quantity, unit ≥ 1 fils, and correct net and VAT.
- The owner sees units, sales, saving and (with costs) profit per promotion for a period.

## 2. Owner decisions (from the conversation)

1. **Kinds:** item or category % or AED off, multi-buy (buy N get M free; N for AED P), whole-basket % off above a
   threshold, and day/hour windows on any of them.
2. **Stacking:** each item gets the single item offer (percent, amount or multi-buy) that saves the most; a basket
   offer then applies on top of the bill.
3. **Manual discounts:** a manual line discount replaces that line's item offer (they never stack); the manager-approval
   limit is unchanged.
4. **Who:** owner and manager create and change promotions; cashiers only see them applied.
5. **Approach:** promotions are managed online, sent to tills in the snapshot, and applied by a pricing engine on the
   till, so it works offline and the receipt always matches what the server stores.

## 3. What already exists

- Manual line discounts: `lib/checkout/pricing.ts` (`discountedUnit`, `LineDiscount`), `components/pos/line-discount-dialog.tsx`;
  the line keeps `listUnitGrossFils`; 2A approval above `manager_discount_pct`.
- `apply_sale_sync` (latest `202610190024_register_access_gate.sql`) requires per line: quantity > 0, unit > 0,
  `gross = net + vat`, `gross = unit × quantity`. Sales sync through `apply_sale_sync_with_payments` (latest
  `202611100056_split_cash_drawer.sql`).
- Categories (2C) on products; `liveCategories`.
- Snapshot: `app/api/v1/snapshot/route.ts` → `lib/snapshot/map-rows.ts`; tills refresh it only at start and after a
  successful sync (`lib/demo-store.ts` `refreshSnapshot`), not on a timer.
- Held carts `lib/checkout/held-carts.ts`; receipts `components/pos/receipt-panel.tsx` and the invoice document.
- `promotions` is a Pro feature in `lib/billing/plans.ts`, used nowhere yet.

## 4. Data and server

Migration `202611120059_promotions.sql`:

- `promotions`: `id uuid pk` (client-made), `business_id`, `name` (trimmed, 1–40), `kind` (`percent_off`,
  `amount_off`, `multi_buy_free`, `multi_buy_price`, `basket_percent`), `target_type` (`product`, `category`, `all`),
  `target_id uuid` (null for `all`), `percent numeric(5,2)`, `amount_fils bigint`, `buy_qty int`, `get_qty int`,
  `bundle_price_fils bigint`, `min_basket_fils bigint`, `starts_on date`, `ends_on date` (null = open-ended),
  `days smallint[]` (ISO 1–7; null = every day), `from_time time`, `to_time time` (both or neither), `active boolean`,
  `archived_at`, `created_at`.
- Checks per kind: percent 0.1–99 (`percent_off`, `basket_percent`); amount 1–100000 fils; `multi_buy_free` buy 1–99,
  get 1–99; `multi_buy_price` buy 2–99, bundle price > 0; basket threshold 0–10000000 fils and target `all`;
  `ends_on >= starts_on`. Target must be this shop's product or category.
- RLS: members (cashier and up) select rows of their shop where `archived_at is null` and not ended (`ends_on` null or
  ≥ Dubai today − 1); no table writes for members.
- `promotion_save(p_business_id, p_promotion jsonb)` (owner/manager, `promotions`): upsert by id with the checks above;
  refusals `invalid_promotion`, `target_not_found`, `feature_not_in_plan`, `not_authorized`. Pause/resume and archive
  go through the same function (`active`, `archived`).
- `promotion_list(p_business_id)` (owner/manager): every promotion including ended and archived, for the manage page.
- `sale_items.promotion_id uuid` (no FK, so archiving never blocks) and `sale_items.promotion_saving_fils bigint`
  (≥ 0). The 056 sale wrapper is replaced to copy `promotionId`/`promotionSavingFils` from each line of the payload
  onto the inserted lines (lines without them stay null), keeping cost stamping and the split-cash movement.
- `promotion_results(p_business_id, p_from, p_to)` (owner/manager, ≤ 92 days, Dubai dates): per promotion id: name,
  times used (distinct sales), units, net sales, saving, and cost and profit when lines carry `unit_cost_fils`.
- Snapshot: members' snapshot includes live promotions (`id, name, kind, target_type, target_id, percent, amount_fils,
  buy_qty, get_qty, bundle_price_fils, min_basket_fils, starts_on, ends_on, days, from_time, to_time, active`).

## 5. The pricing engine (`lib/promotions/engine.ts`)

`applyPromotions(cart, promotions, products, now) → PricedCart`, pure.

1. Live promotions: `active`, not archived, Dubai date within `starts_on..ends_on`, Dubai ISO weekday in `days`,
   Dubai time within `from_time..to_time` (a window may cross midnight: 22:00–02:00).
2. Item offers: for each cart line from a product, without a manual discount: candidates are live percent, amount and
   multi-buy promotions whose target is the product, its live category, or `all`. Compute each one's saving on that
   line; keep the largest; ties go to the earlier `created_at`.
   - `percent_off`: each unit's price × percent, rounded to fils.
   - `amount_off`: min(amount, unit − 1 fils) per unit.
   - `multi_buy_free` (buy N get M): groups of N + M units; each complete group saves M × unit, spread over its N + M
     units; units not in a complete group pay list.
   - `multi_buy_price` (N for P): each complete group of N saves N × unit − P (if positive), spread over its N units.
   - Multi-buys count units of one product (a category multi-buy does not mix products).
3. Basket offer: after item offers, total = sum of line totals; among live `basket_percent` offers with
   `min_basket_fils` ≤ total, the one saving most applies; its saving is spread over all lines (including manual-discount
   lines) in proportion to line totals.
4. Whole fils: a line's total after savings is split into whole-fils unit prices: `base = floor(total / qty)`,
   `extra = total − base × qty` units cost `base + 1`, the rest `base`; this yields at most two lines per cart line,
   each with gross = unit × quantity. No unit goes below 1 fils (the saving is capped).
5. Output per line: `unitGrossFils`, `quantity`, `listUnitGrossFils`, `promotionId`, `promotionName`,
   `promotionSavingFils` (for a basket offer on a line that also has an item offer, the line records the larger of the
   two savings' promotions and the combined saving); and totals `promotionSavingFils`.
6. Manual discount: a line with a manual discount (`manualDiscount: true`) takes no item offer.

The cart keeps the list prices; pricing runs again on every cart change, on bringing back a held cart, and right before
completing the sale (the time window is judged at that moment).

## 6. Screens

- Promotions page (`/promotions`, owner and manager; managers via the 2D manager page rule; Starter → Pro card):
  tabs Active now, Scheduled, Ended, Archived; rows with name, kind, target, when, a live switch; Results tab with
  period chips and the `promotion_results` table and CSV.
- Form: kind, target (product search / category / everything; basket is always everything), value fields per kind,
  dates, optional days and hours, and a plain preview, e.g. "Buy 2 get 1 free on Cola 330ml · 1–30 Nov · Fri
  16:00–19:00". Saving needs a connection.
- Till: cart lines show "Promotion name · −AED x"; totals show "Promotions −AED x"; the receipt and A4 invoice show list
  price, promotion and charged price per line and "You saved AED x".
- Daily report totals gain "Promotions saving" from the till's records.
- Snapshot freshness: while online, tills refresh the snapshot every 5 minutes and when the tab regains focus; saving a
  promotion refreshes the saving browser at once.

## 7. Refunds and errors

- A refund returns the price charged on the line (credit notes already copy it), so a saving is never paid twice.
- Invalid promotion fields → "Check the promotion: …" with the failing rule; a target from another shop → refused.
- An archived product or category target never matches; leaving Pro: promotions are kept, stop applying, page locks.

## 8. Rollout

1. Apply `202611120059_promotions` (safe before the app: older tills send no promotion fields).
2. Deploy the 2E app after 059.

## 9. Testing

- Unit (engine): each kind alone; best offer wins and tie to the older; buy 2 get 1 on 3, 4, 6 units; 3 for AED 10
  with remainders; basket below/at/above the threshold and on top of item offers; manual discount drops the item offer
  but keeps the basket; splits keep gross = unit × qty and unit ≥ 1; time windows across midnight and Friday in Dubai;
  inactive, archived, out-of-dates offers ignored; held cart repriced.
- SQL: save rules and refusals; cashier cannot write but sees live promotions; ended/archived hidden from members; the
  wrapper stores promotion fields; results totals; Starter refused.
- Browser: each kind at the till online and offline, receipt saving, refund at the charged price, results page, Starter
  Pro card.

## 10. Out of scope

- Mix-and-match multi-buys across products; coupon codes; customer-specific prices or loyalty; promotions per branch;
  fixed-AED basket discounts.

## 11. Open items

- None blocking.
