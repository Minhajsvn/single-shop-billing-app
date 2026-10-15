# Stage 1C: Checkout Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the POS into a dependable cashier flow:
- scan-to-add with feedback
- per-item discounts recorded on the invoice
- a payment step with cash received and change due
- a receipt panel instead of a page reload
- hold and resume
- a stale-register guard
- a POS layout that works on tablets and phones

**Architecture:**
- Every rule a cashier depends on is a small pure module under `lib/checkout/`, unit-tested first: discount maths, change and quick-cash amounts, code lookup, held carts, and stale-register detection.
- `components/pos-workspace.tsx` is split into focused components that consume those modules.
- The receipt markup moves into one shared component, used by both the invoice page and the new receipt panel.
- One small migration records each line's list price, so that invoices can show the discount, as UAE tax invoices require.

**Tech Stack:** Next.js 16 client components, React 19, Supabase Postgres (one migration plus an RPC redefinition), Node 24 test runner, Web Audio API for the scan beep.

**Spec:** `docs/superpowers/specs/2026-10-11-saas-plans-and-improvements-design.md`, §4 (Critical items 2–4 and "POS / checkout") and §5 Stage 1 item 4.
**Builds on:**
- 1A (merged `28b54c6`)
- 1B (merged `23ccb72`): hosted store, per-till numbering, `useShopContext()`, `refreshSnapshot()`. Read `docs/superpowers/plans/2026-10-13-stage-1b-ledger.md` for deferred items.

**Owner decisions (2026-10-15):**
- Discounts are **per item** only (percent, or an amount off each unit); no whole-bill discount.
- After a sale, show a **receipt panel**, where Enter or "New sale" starts the next sale. No auto-print.

## Global Constraints

- Money is integer minor units (fils); never store fractions.
- A line's `unitGrossFils` is the price actually charged (after any discount), and `grossFils = unitGrossFils × quantity` exactly. The server enforces this.
- `listUnitGrossFils`, when present, is the undiscounted unit price and must be `≥ unitGrossFils`.
- VAT is computed per line from the charged gross (`calculateVatInclusive`), as today.
- **UAE tax invoices must show any discount.** Persist the list price for every discounted line, and show "was X, saved Y" on both the receipt and the A4 invoice.
- Completed invoices are immutable. Discounts happen in the cart only, never after checkout.
- Cash change is computed in fils. Cash received must be ≥ the total; card payments have no change.
- Business dates use `Asia/Dubai` (`dubaiSupplyDate` from `lib/invoice-numbers.ts`).
- Touch targets in the POS must be at least **44 × 44 px**.
- Held carts live only in this browser, per till. They are not fiscal documents, never sync, and are capped at **10**.
- Code imported by `node --test` uses relative imports **with `.ts`**.
- Read the relevant `node_modules/next/dist/docs/` guide before writing Next.js code (AGENTS.md).
- Database work uses LOCAL Supabase only, as in 1B: Docker PATH prefix, `supabase db reset`, `npm run test:sql`, `npm run test:rehearsal`.

## Review Focus

1. **Discount rounding.** A 15% discount on AED 2.85 must charge a whole number of fils per unit, and quantity × unit must equal the line total. Covered in Task 1.
2. **Cash received below the total, or empty, or non-numeric.** Completion must be impossible, with a clear message. Covered in Tasks 1 and 4.
3. **Scanning an unknown barcode.** The cart must be untouched, with a visible "Add product" offer, never a silent no-op. Covered in Tasks 2 and 5.
4. **A register opened on a previous Dubai day is still open.** Checkout is blocked until it is closed, including around Dubai midnight. Covered in Task 3.
5. **Resuming a held cart whose product is now out of stock or inactive.** Unavailable lines must be dropped or capped, with a message, never sold beyond stock. Covered in Task 6.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/checkout/pricing.ts` (create) | Per-item discount maths, cart totals, change due, quick cash amounts |
| `lib/checkout/lookup.ts` (create) | Exact barcode/SKU lookup for scans |
| `lib/checkout/register-status.ts` (create) | Detects a register left open from a previous Dubai day |
| `lib/checkout/held-carts.ts` (create) | Hold/resume rules and storage key per till |
| `lib/print.ts` (create) | `printDocument(mode)`: sets the print mode, prints, and cleans up |
| `lib/domain.ts` (modify) | `InvoiceLine.listUnitGrossFils?`, `CheckoutLine.listUnitGrossFils?` |
| `lib/demo-store.ts` (modify) | `completeSale` keeps `listUnitGrossFils`; `CheckoutLine` gains it |
| `lib/sync/request-schema.ts`, `lib/snapshot/*`, `app/api/v1/snapshot/route.ts` (modify) | Carry `listUnitGrossFils` / `list_unit_gross_fils` |
| `supabase/migrations/202610150018_sale_item_list_price.sql` (create) | Column, check, and `apply_sale_sync` storing the list price |
| `components/receipt-document.tsx` (create) | Shared 80mm receipt markup, including discounts |
| `components/pos/payment-dialog.tsx` (create) | Cash received, change due, Complete; card confirm |
| `components/pos/receipt-panel.tsx` (create) | Post-sale panel: invoice number, total, change, print, New sale |
| `components/pos/line-discount-dialog.tsx` (create) | Per-line % or amount-off-each discount |
| `components/pos/held-carts.tsx` (create) | Hold button and the held-cart list |
| `components/pos-workspace.tsx` (modify) | Orchestrates the above; scan-to-add; stale-register guard |
| `components/invoice-detail-workspace.tsx` (modify) | Uses `ReceiptDocument` and `printDocument`; A4 shows discounts |
| `components/register-workspace.tsx` (modify) | Stale-register banner |
| `components/inventory-workspace.tsx` (modify) | Opens "Add product" prefilled from `?barcode=` |
| `app/globals.css` (modify) | Tablet two-column POS, phone cart bar, 44px targets, panel and dialog styles |
| `tests/checkout-pricing.test.mjs`, `tests/checkout-lookup.test.mjs`, `tests/register-status.test.mjs`, `tests/held-carts.test.mjs` (create) | Unit tests |

---

### Task 1: Discount, totals and change maths

**Files:**
- Create: `lib/checkout/pricing.ts`
- Test: `tests/checkout-pricing.test.mjs`

**Interfaces:**
- Consumes: `calculateVatInclusive(grossFils)` from `lib/domain.ts`
- Produces:
  - `type LineDiscount = { kind: "percent"; percent: number } | { kind: "amount"; offEachFils: number }`
  - `discountedUnit(listUnitGrossFils: number, discount: LineDiscount): { ok: true; unitGrossFils: number } | { ok: false; error: string }`
  - `cartTotals(lines: { unitGrossFils: number; quantity: number; listUnitGrossFils?: number }[]): { netFils; vatFils; grossFils; discountFils: number }`
  - `changeDue(totalFils: number, tenderedFils: number): { ok: true; changeFils: number } | { ok: false; error: string }`
  - `quickCashAmounts(totalFils: number): number[]`: up to 4 ascending amounts in fils, starting with the exact total
  - `parseMoneyInput(text: string): number | null`: "28.5" becomes 2850; anything invalid returns null

- [ ] **Step 1: Write the failing test** in `tests/checkout-pricing.test.mjs`

```js
import assert from "node:assert/strict";
import test from "node:test";
import { cartTotals, changeDue, discountedUnit, parseMoneyInput, quickCashAmounts } from "../lib/checkout/pricing.ts";

test("percent discounts round each unit to whole fils (half up)", () => {
  assert.deepEqual(discountedUnit(285, { kind: "percent", percent: 15 }), { ok: true, unitGrossFils: 242 });
  assert.deepEqual(discountedUnit(2850, { kind: "percent", percent: 10 }), { ok: true, unitGrossFils: 2565 });
  assert.deepEqual(discountedUnit(2850, { kind: "percent", percent: 12.5 }), { ok: true, unitGrossFils: 2494 });
});

test("amount discounts take a fixed sum off each unit", () => {
  assert.deepEqual(discountedUnit(2850, { kind: "amount", offEachFils: 350 }), { ok: true, unitGrossFils: 2500 });
});

test("a discount can never make an item free or negative", () => {
  assert.equal(discountedUnit(2850, { kind: "percent", percent: 100 }).ok, false);
  assert.equal(discountedUnit(2850, { kind: "amount", offEachFils: 2850 }).ok, false);
  assert.equal(discountedUnit(2850, { kind: "percent", percent: 0 }).ok, false);
  assert.equal(discountedUnit(2850, { kind: "percent", percent: -5 }).ok, false);
  assert.equal(discountedUnit(2850, { kind: "amount", offEachFils: 10.5 }).ok, false);
});

test("cart totals add up per line and report the total saving", () => {
  const totals = cartTotals([
    { unitGrossFils: 242, quantity: 3, listUnitGrossFils: 285 },
    { unitGrossFils: 1000, quantity: 1 },
  ]);
  assert.equal(totals.grossFils, 242 * 3 + 1000);
  assert.equal(totals.netFils + totals.vatFils, totals.grossFils);
  assert.equal(totals.discountFils, (285 - 242) * 3);
});

test("change due needs enough cash", () => {
  assert.deepEqual(changeDue(5700, 10000), { ok: true, changeFils: 4300 });
  assert.deepEqual(changeDue(5700, 5700), { ok: true, changeFils: 0 });
  assert.equal(changeDue(5700, 5000).ok, false);
});

test("quick cash amounts start exact and climb to common notes", () => {
  assert.deepEqual(quickCashAmounts(5700), [5700, 6000, 10000, 20000]);
  assert.deepEqual(quickCashAmounts(10000), [10000, 20000, 50000, 100000]);
  assert.deepEqual(quickCashAmounts(123456), [123456, 123500, 124000, 125000]);
});

test("money input is parsed strictly", () => {
  assert.equal(parseMoneyInput("28.5"), 2850);
  assert.equal(parseMoneyInput(" 100 "), 10000);
  assert.equal(parseMoneyInput("0.05"), 5);
  assert.equal(parseMoneyInput(""), null);
  assert.equal(parseMoneyInput("abc"), null);
  assert.equal(parseMoneyInput("1.234"), null);
  assert.equal(parseMoneyInput("-5"), null);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --experimental-strip-types --test tests/checkout-pricing.test.mjs`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Create `lib/checkout/pricing.ts`**

```ts
import { calculateVatInclusive } from "../domain.ts";

export type LineDiscount = { kind: "percent"; percent: number } | { kind: "amount"; offEachFils: number };

export function discountedUnit(listUnitGrossFils: number, discount: LineDiscount): { ok: true; unitGrossFils: number } | { ok: false; error: string } {
  if (discount.kind === "percent") {
    if (!Number.isFinite(discount.percent) || discount.percent <= 0 || discount.percent >= 100) {
      return { ok: false, error: "Enter a discount above 0% and below 100%." };
    }
    const unitGrossFils = Math.round((listUnitGrossFils * (100 - discount.percent)) / 100);
    return unitGrossFils >= 1 ? { ok: true, unitGrossFils } : { ok: false, error: "That discount would make the item free." };
  }
  if (!Number.isInteger(discount.offEachFils) || discount.offEachFils <= 0) return { ok: false, error: "Enter an amount off each item." };
  const unitGrossFils = listUnitGrossFils - discount.offEachFils;
  return unitGrossFils >= 1 ? { ok: true, unitGrossFils } : { ok: false, error: "The discount must be less than the item price." };
}

export function cartTotals(lines: { unitGrossFils: number; quantity: number; listUnitGrossFils?: number }[]) {
  return lines.reduce((totals, line) => {
    const amounts = calculateVatInclusive(line.unitGrossFils * line.quantity);
    const saving = line.listUnitGrossFils ? (line.listUnitGrossFils - line.unitGrossFils) * line.quantity : 0;
    return {
      netFils: totals.netFils + amounts.netFils,
      vatFils: totals.vatFils + amounts.vatFils,
      grossFils: totals.grossFils + amounts.grossFils,
      discountFils: totals.discountFils + saving,
    };
  }, { netFils: 0, vatFils: 0, grossFils: 0, discountFils: 0 });
}

export function changeDue(totalFils: number, tenderedFils: number): { ok: true; changeFils: number } | { ok: false; error: string } {
  if (!Number.isInteger(tenderedFils) || tenderedFils < totalFils) return { ok: false, error: "Cash received must cover the total." };
  return { ok: true, changeFils: tenderedFils - totalFils };
}

const NOTE_STEPS_FILS = [500, 1000, 5000, 10000, 20000, 50000, 100000];

export function quickCashAmounts(totalFils: number): number[] {
  const amounts = [totalFils];
  for (const step of NOTE_STEPS_FILS) {
    const rounded = Math.ceil(totalFils / step) * step;
    if (rounded > amounts[amounts.length - 1]) amounts.push(rounded);
    if (amounts.length === 4) break;
  }
  return amounts;
}

export function parseMoneyInput(text: string): number | null {
  const value = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
```

Check the `quickCashAmounts` expectations against this code before running. For 5700: the 500 step gives 6000, the 1000 step gives 6000 (not greater, skipped), the 5000 step gives 10000, and the 10000 step gives 10000 (skipped). The 20000 step then gives 20000, which makes `[5700, 6000, 10000, 20000]`. That matches the test. If any expectation doesn't match this algorithm, fix the **test arithmetic**, not the rule: exact first, then each strictly larger rounding up to the next 5/10/50/100/200/500/1000 AED. Record the ruling in the report.

- [ ] **Step 4: Run the tests**

Run: `node --experimental-strip-types --test tests/checkout-pricing.test.mjs && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/checkout/pricing.ts tests/checkout-pricing.test.mjs
git commit -m "feat(checkout): discount, totals and change maths"
```

---

### Task 2: Scan lookup, stale-register check, held carts

**Files:**
- Create: `lib/checkout/lookup.ts`, `lib/checkout/register-status.ts`, `lib/checkout/held-carts.ts`
- Test: `tests/checkout-lookup.test.mjs`, `tests/register-status.test.mjs`, `tests/held-carts.test.mjs`

**Interfaces:**
- Consumes: `Product`, `RegisterSession`, `CheckoutLine` from `lib/domain.ts` / `lib/demo-store.ts`; `dubaiSupplyDate(date: Date): string` from `lib/invoice-numbers.ts`
- Produces:
  - `findByCode(products: Product[], code: string): Product | null`: exact match on barcode, or a case-insensitive exact match on SKU, among **active** products. Whitespace is trimmed, and an empty code returns null.
  - `staleRegister(register: RegisterSession | null, now: Date): { stale: false } | { stale: true; openedOn: string }`: stale when the register is open and its Dubai opening date is before today's Dubai date.
  - `type HeldCart = { id: string; heldAt: string; customerId?: string; lines: HeldLine[] }`, where `HeldLine = { productId?: string; name: string; sku?: string; quantity: number; unitGrossFils: number; listUnitGrossFils?: number }`
  - `MAX_HELD_CARTS = 10`
  - `heldCartsKey(deviceId: string | null): string`, which gives `shop-ledger-held-carts-v1:<deviceId or "local">`
  - `holdCart(list: HeldCart[], cart: Omit<HeldCart, "id" | "heldAt">, id: string, now: Date): { ok: true; list: HeldCart[] } | { ok: false; error: string }`
  - `resumeCart(list: HeldCart[], id: string, products: Product[]): { ok: true; cart: HeldCart; list: HeldCart[]; notices: string[] } | { ok: false; error: string }`

  `resumeCart` caps each product line at current stock and drops lines whose product is inactive, missing or out of stock, adding a notice for each. Custom lines (no `productId`) pass through unchanged.

- [ ] **Step 1: Write the failing tests**

`tests/checkout-lookup.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { findByCode } from "../lib/checkout/lookup.ts";

const products = [
  { id: "p1", name: "Coffee", sku: "COF-250", barcode: "6291100211014", priceFils: 2850, stock: 5, lowStockThreshold: 1, active: true },
  { id: "p2", name: "Tea", sku: "TEA-1", barcode: "6291100211021", priceFils: 1000, stock: 5, lowStockThreshold: 1, active: false },
  { id: "p3", name: "Dates", sku: "6291100211014X", priceFils: 1000, stock: 5, lowStockThreshold: 1, active: true },
];

test("scans match barcodes and SKUs exactly", () => {
  assert.equal(findByCode(products, "6291100211014")?.id, "p1");
  assert.equal(findByCode(products, " cof-250 ")?.id, "p1");
  assert.equal(findByCode(products, "62911002110")?.id, undefined, "no partial matches");
});

test("inactive products and empty codes never match", () => {
  assert.equal(findByCode(products, "6291100211021"), null);
  assert.equal(findByCode(products, "   "), null);
});
```

`tests/register-status.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { staleRegister } from "../lib/checkout/register-status.ts";

const open = (openedAt) => ({ id: "r", status: "open", openedAt, openingCashFils: 0, adjustments: [] });

test("a register opened earlier on the same Dubai day is not stale", () => {
  assert.deepEqual(staleRegister(open("2026-10-15T04:00:00Z"), new Date("2026-10-15T19:59:00Z")), { stale: false });
});

test("Dubai midnight (20:00 UTC) makes yesterday's register stale", () => {
  assert.deepEqual(staleRegister(open("2026-10-15T04:00:00Z"), new Date("2026-10-15T20:00:00Z")), { stale: true, openedOn: "2026-10-15" });
});

test("closed or missing registers are never stale", () => {
  assert.deepEqual(staleRegister({ ...open("2026-10-01T04:00:00Z"), status: "closed" }, new Date("2026-10-15T10:00:00Z")), { stale: false });
  assert.deepEqual(staleRegister(null, new Date()), { stale: false });
});
```

`tests/held-carts.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { MAX_HELD_CARTS, heldCartsKey, holdCart, resumeCart } from "../lib/checkout/held-carts.ts";

const now = new Date("2026-10-15T10:00:00Z");
const product = (id, stock, active = true) => ({ id, name: id, sku: id, priceFils: 1000, stock, lowStockThreshold: 0, active });
const line = (productId, quantity) => ({ productId, name: productId, sku: productId, quantity, unitGrossFils: 1000 });

test("held carts are keyed per till", () => {
  assert.equal(heldCartsKey("dev-1"), "shop-ledger-held-carts-v1:dev-1");
  assert.equal(heldCartsKey(null), "shop-ledger-held-carts-v1:local");
});

test("holding adds newest first and refuses empty carts and the 11th cart", () => {
  const first = holdCart([], { lines: [line("a", 1)] }, "h1", now);
  assert.equal(first.ok && first.list[0].id, "h1");
  assert.equal(holdCart([], { lines: [] }, "h0", now).ok, false);
  const full = Array.from({ length: MAX_HELD_CARTS }, (_, index) => ({ id: `h${index}`, heldAt: now.toISOString(), lines: [line("a", 1)] }));
  assert.equal(holdCart(full, { lines: [line("a", 1)] }, "h99", now).ok, false);
});

test("resuming removes the cart from the list and caps lines at current stock", () => {
  const list = [{ id: "h1", heldAt: now.toISOString(), lines: [line("a", 5), line("b", 1), line("gone", 1), { name: "Gift wrap", quantity: 1, unitGrossFils: 500 }] }];
  const result = resumeCart(list, "h1", [product("a", 2), product("b", 0)]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.list, []);
  assert.deepEqual(result.cart.lines.map((item) => [item.name, item.quantity]), [["a", 2], ["Gift wrap", 1]]);
  assert.equal(result.notices.length, 3, "capped a, dropped b (out of stock) and gone (missing)");
});

test("resuming an unknown cart fails", () => {
  assert.equal(resumeCart([], "nope", []).ok, false);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --experimental-strip-types --test tests/checkout-lookup.test.mjs tests/register-status.test.mjs tests/held-carts.test.mjs`
Expected: FAIL with `Cannot find module` (×3).

- [ ] **Step 3: Implement**

`lib/checkout/lookup.ts`:

```ts
import type { Product } from "../domain.ts";

/** Exact scan match: barcode first, then SKU (case-insensitive). Never partial, never inactive. */
export function findByCode(products: Product[], code: string): Product | null {
  const value = code.trim();
  if (!value) return null;
  const active = products.filter((product) => product.active);
  return active.find((product) => product.barcode === value)
    ?? active.find((product) => product.sku.toLowerCase() === value.toLowerCase())
    ?? null;
}
```

`lib/checkout/register-status.ts`:

```ts
import type { RegisterSession } from "../domain.ts";
import { dubaiSupplyDate } from "../invoice-numbers.ts";

/** A register still open from an earlier Dubai business day must be closed before more sales. */
export function staleRegister(register: RegisterSession | null, now: Date): { stale: false } | { stale: true; openedOn: string } {
  if (!register || register.status !== "open") return { stale: false };
  const openedOn = dubaiSupplyDate(new Date(register.openedAt));
  return openedOn < dubaiSupplyDate(now) ? { stale: true, openedOn } : { stale: false };
}
```

`lib/checkout/held-carts.ts`:

```ts
import type { Product } from "../domain.ts";

export type HeldLine = { productId?: string; name: string; sku?: string; quantity: number; unitGrossFils: number; listUnitGrossFils?: number };
export type HeldCart = { id: string; heldAt: string; customerId?: string; lines: HeldLine[] };

export const MAX_HELD_CARTS = 10;

export function heldCartsKey(deviceId: string | null): string {
  return `shop-ledger-held-carts-v1:${deviceId ?? "local"}`;
}

export function holdCart(list: HeldCart[], cart: Omit<HeldCart, "id" | "heldAt">, id: string, now: Date): { ok: true; list: HeldCart[] } | { ok: false; error: string } {
  if (!cart.lines.length) return { ok: false, error: "Add an item before holding the sale." };
  if (list.length >= MAX_HELD_CARTS) return { ok: false, error: `You can hold up to ${MAX_HELD_CARTS} sales. Resume or clear one first.` };
  return { ok: true, list: [{ ...cart, id, heldAt: now.toISOString() }, ...list] };
}

export function resumeCart(list: HeldCart[], id: string, products: Product[]): { ok: true; cart: HeldCart; list: HeldCart[]; notices: string[] } | { ok: false; error: string } {
  const held = list.find((cart) => cart.id === id);
  if (!held) return { ok: false, error: "That held sale is no longer available." };
  const notices: string[] = [];
  const lines = held.lines.flatMap((line) => {
    if (!line.productId) return [line];
    const product = products.find((candidate) => candidate.id === line.productId);
    if (!product || !product.active || product.stock < 1) {
      notices.push(`${line.name} is no longer available and was removed.`);
      return [];
    }
    if (line.quantity > product.stock) {
      notices.push(`${line.name} reduced to ${product.stock} (stock changed).`);
      return [{ ...line, quantity: product.stock }];
    }
    return [line];
  });
  return { ok: true, cart: { ...held, lines }, list: list.filter((cart) => cart.id !== id), notices };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --experimental-strip-types --test tests/checkout-lookup.test.mjs tests/register-status.test.mjs tests/held-carts.test.mjs && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/checkout tests/checkout-lookup.test.mjs tests/register-status.test.mjs tests/held-carts.test.mjs
git commit -m "feat(checkout): scan lookup, stale-register check and held carts"
```

---

### Task 3: Record list prices on invoices (database and sync)

**Files:**
- Create: `supabase/migrations/202610150018_sale_item_list_price.sql`
- Modify:
  - `supabase/tests/foundation_test.sql` (append section 17 before `rollback;`)
  - `lib/domain.ts`
  - `lib/sync/request-schema.ts`
  - `lib/snapshot/types.ts`
  - `lib/snapshot/map-rows.ts`
  - `app/api/v1/snapshot/route.ts`
  - `tests/snapshot-map.test.mjs`
  - `tests/sync-request.test.mjs`

**Interfaces:**
- Consumes: `apply_sale_sync` as defined in `supabase/migrations/202610130016_tills_and_sync_device.sql`. That is the CURRENT definition; copy it from there, not from 0007.
- Produces:
  - `sale_items.list_unit_gross_fils bigint null`, with `check (list_unit_gross_fils is null or list_unit_gross_fils >= unit_gross_fils)`
  - `InvoiceLine.listUnitGrossFils?: number`
  - the sync schema accepts `listUnitGrossFils` on sale lines
  - the snapshot maps it back

- [ ] **Step 1: Write the failing tests.**

Append to `supabase/tests/foundation_test.sql` before the final `rollback;`, running as the migration owner. The section calls the real RPC as owner A.

```sql
-- 17. Discounted sale lines keep their list price (UAE tax invoices must show discounts).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select public.apply_sale_sync(
  gen_random_uuid(),
  'b0000000-0000-4000-8000-00000000000a',
  'a1000000-0000-4000-8000-000000000017',
  jsonb_build_object(
    'deviceId', 'd0000000-0000-4000-8000-00000000000a',
    'register', null,
    'sale', jsonb_build_object(
      'id', 'a1000000-0000-4000-8000-000000000017', 'invoiceNumber', 'T17-1', 'status', 'completed',
      'createdAt', now(), 'supplyDate', current_date, 'paymentMethod', 'card',
      'netFils', 230, 'vatFils', 12, 'grossFils', 242,
      'lines', jsonb_build_array(jsonb_build_object(
        'id', 'a1000000-0000-4000-8000-0000000017a1', 'name', 'Discounted', 'quantity', 1,
        'unitGrossFils', 242, 'listUnitGrossFils', 285, 'netFils', 230, 'vatFils', 12, 'grossFils', 242
      ))
    )
  )
);
reset role;
do $$ begin
  assert (select list_unit_gross_fils from public.sale_items where id = 'a1000000-0000-4000-8000-0000000017a1') = 285, 'list price stored';
  begin
    update public.sale_items set list_unit_gross_fils = 100 where id = 'a1000000-0000-4000-8000-0000000017a1';
    assert false, 'list price below the charged price must be rejected';
  exception when check_violation then null;
  end;
end $$;
```

If the RPC requires an open register for this device (it opens one when `register` is null, per 0007's logic), keep the call as is. If it raises instead, insert an open `register_sessions` row for device `d0000000-…0a` first, as the owner, and note that in the report.

Add a mapper test to `tests/snapshot-map.test.mjs`:

```js
test("discounted lines keep their list price", () => {
  const discounted = { ...rows, sales: [{ ...rows.sales[0], sale_items: [{ ...rows.sales[0].sale_items[0], list_unit_gross_fils: 3000 }] }] };
  assert.equal(mapSnapshotRows(discounted, "x").state.sales[0].lines[0].listUnitGrossFils, 3000);
  assert.equal(mapSnapshotRows(rows, "x").state.sales[0].lines[0].listUnitGrossFils, undefined);
});
```

Add to `tests/sync-request.test.mjs`. Build a minimal valid sale operation by reusing the shapes of the existing tests:

```js
test("sale lines keep their list price through validation", () => {
  const sale = {
    id: "a1000000-0000-4000-8000-000000000001", invoiceNumber: "SMK-1-261015-0001", status: "completed",
    createdAt: "2026-10-15T08:00:00Z", supplyDate: "2026-10-15", paymentMethod: "cash",
    netFils: 230, vatFils: 12, grossFils: 242,
    lines: [{ id: "a1000000-0000-4000-8000-0000000000a1", name: "Coffee", quantity: 1, unitGrossFils: 242, listUnitGrossFils: 285, netFils: 230, vatFils: 12, grossFils: 242 }],
  };
  const parsed = requestSchema.parse({ operations: [base("sale", sale.id, { sale, deviceId })] });
  assert.equal(parsed.operations[0].payload.sale.lines[0].listUnitGrossFils, 285);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test:sql` (FAIL: column `list_unit_gross_fils` does not exist) and `npm test` (FAIL: the two new JS tests).

- [ ] **Step 3: Write `supabase/migrations/202610150018_sale_item_list_price.sql`**

- Header comment: `-- Stage 1C: per-item discounts. Store each discounted line's list price so tax invoices can show the discount.`
- `alter table public.sale_items add column list_unit_gross_fils bigint;`
- `alter table public.sale_items add constraint sale_items_list_price_not_below_charge check (list_unit_gross_fils is null or list_unit_gross_fils >= unit_gross_fils);`
- Copy the **current** `apply_sale_sync` definition **verbatim** from `supabase/migrations/202610130016_tills_and_sync_device.sql`, from its `create or replace function public.apply_sale_sync(` line through `$$;` and its trailing grant/revoke lines. Then make only these replacements:
  1. The column list `      unit_gross_fils, net_fils, vat_fils, gross_fils\n    )` inside `insert into public.sale_items (` becomes `      unit_gross_fils, net_fils, vat_fils, gross_fils, list_unit_gross_fils\n    )`.
  2. The values tail `      line_unit_gross, line_net, line_vat, line_gross\n    );` becomes `      line_unit_gross, line_net, line_vat, line_gross,\n      nullif(line_record->>'listUnitGrossFils', '')::bigint\n    );`.
- After the copy, add `alter function public.apply_sale_sync(uuid, uuid, uuid, jsonb) set search_path = public, extensions, pg_temp;`. That keeps the 202610100001 hotfix, which section 11 checks.
- Do the copy with a small Node script; commit only the `.sql`. Diff the copied function against the 016 version and confirm that only those two hunks differ.

- [ ] **Step 4: TypeScript plumbing**
  - `lib/domain.ts`: add `listUnitGrossFils?: number;` to `InvoiceLine`, with the comment `/** Undiscounted unit price, present only when the line was discounted. */`.
  - `lib/demo-store.ts`: change `CheckoutLine` to `{ productId?: string; name: string; sku?: string; quantity: number; unitGrossFils: number; listUnitGrossFils?: number }`. `completeSale` already spreads the input line into the invoice line, so `listUnitGrossFils` flows through. Confirm it does.
  - `lib/sync/request-schema.ts`: in `saleLineSchema`, add `listUnitGrossFils: z.number().int().positive().optional()`.
  - `lib/snapshot/types.ts`: `LineRow` gains `list_unit_gross_fils?: number | null`.
  - `lib/snapshot/map-rows.ts`: `mapLine` sets `listUnitGrossFils: row.list_unit_gross_fils == null ? undefined : Number(row.list_unit_gross_fils)`.
  - `app/api/v1/snapshot/route.ts`: add `list_unit_gross_fils` to the `sale_items!…(...)` select list.

- [ ] **Step 5: Apply and run everything**

Run `supabase db reset`, then `npm run test:sql && npm run test:rehearsal && npm test && npm run lint && npm run typecheck`.
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/202610150018_sale_item_list_price.sql supabase/tests/foundation_test.sql lib/domain.ts lib/demo-store.ts lib/sync/request-schema.ts lib/snapshot/types.ts lib/snapshot/map-rows.ts app/api/v1/snapshot/route.ts tests/snapshot-map.test.mjs tests/sync-request.test.mjs
git commit -m "feat: record list prices for discounted invoice lines"
```

---

### Task 4: Shared receipt, print helper, payment dialog, receipt panel

**Files:**
- Create:
  - `lib/print.ts`
  - `components/receipt-document.tsx`
  - `components/pos/payment-dialog.tsx`
  - `components/pos/receipt-panel.tsx`
- Modify:
  - `components/invoice-detail-workspace.tsx`
  - `components/pos-workspace.tsx`
  - `app/globals.css`

**Interfaces:**
- Consumes:
  - `changeDue`, `quickCashAmounts`, `parseMoneyInput`, `cartTotals` (Task 1)
  - `completeSale(lines, paymentMethod, customerId)`
  - `useShopContext()`
- Produces:
  - `printDocument(mode: "receipt" | "a4" | "daily-report"): void`
  - `<ReceiptDocument sale={Sale} shop={{ name, trn, address, phone, footer }} />`
  - `<PaymentDialog method={"cash"|"card"} totalFils={number} onCancel={() => void} onComplete={(tenderedFils: number | null) => void} />`
  - `<ReceiptPanel sale={Sale} tenderedFils={number | null} shop={...} onNewSale={() => void} />`

- [ ] **Step 1: `lib/print.ts`.** Extract the print logic from `invoice-detail-workspace.tsx`, unchanged in behaviour:

```ts
export type PrintMode = "receipt" | "a4" | "daily-report";

/** Prints one document: CSS in app/globals.css shows only the element matching html[data-print-mode]. */
export function printDocument(mode: PrintMode): void {
  document.documentElement.dataset.printMode = mode;
  window.addEventListener("afterprint", () => { delete document.documentElement.dataset.printMode; }, { once: true });
  window.setTimeout(() => window.print(), 0);
}
```

Replace the local `print()` in `invoice-detail-workspace.tsx` with `printDocument`. Also replace the daily-report print code in `components/reports-workspace.tsx` if it duplicates the same three lines.

- [ ] **Step 2: `components/receipt-document.tsx`.** Move the `<article className="receipt-document">…</article>` markup out of `invoice-detail-workspace.tsx` into this component, unchanged, then add:
  - **Discounted lines:** under the `{quantity} × {unit}` text, add a second span reading `was {formatAED(listUnitGrossFils)} · saved {formatAED((list − unit) × qty)}`.
  - **A total saving row** above Net when any line is discounted: `<div><span>You saved</span><strong>{formatAED(totalSaving)}</strong></div>`.

  `invoice-detail-workspace.tsx` renders `<ReceiptDocument sale={sale} shop={shop} />` in the old article's place. Its A4 table also shows, under each discounted line's description, `List {formatAED(list)} · discount {formatAED(saving)}`.

- [ ] **Step 3: `components/pos/payment-dialog.tsx`.** It uses the existing modal classes (`modal-backdrop`, `modal`, `modal-header`, `modal-footer`).
  - **Cash:**
    - Shows the total.
    - Has an `inputMode="decimal"` field labelled "Cash received (AED)", autofocused and prefilled with the exact total.
    - Has buttons for each `quickCashAmounts(totalFils)` value.
    - Shows a live "Change due" in large type.
    - The **Complete sale** button is disabled until `changeDue(...)` is ok. Enter submits; Escape cancels.
    - Shows the `changeDue` / `parseMoneyInput` error under the field when the value is invalid or short.
  - **Card:** "Confirm the card terminal approved AED {total}", with **Complete sale** autofocused (Enter submits) and Cancel.
  - Calls `onComplete(tenderedFils)` with the cash amount in fils, or `null` for card.

- [ ] **Step 4: `components/pos/receipt-panel.tsx`.** A side panel that replaces the cart panel after a sale:
  - a success heading "Sale complete"
  - the invoice number
  - the total
  - for cash, "Cash received" and "Change due" (computed with `changeDue(sale.grossFils, tenderedFils)`)
  - buttons **Print 80mm** (`printDocument("receipt")`), **Print A4** (link to `/sales/{id}`), and **New sale** (autofocused)
  - it renders `<ReceiptDocument>` so that printing works from the POS
  - Enter triggers New sale

- [ ] **Step 5: Wire up `components/pos-workspace.tsx`**
  - Add state `payment: { method: "cash" | "card" } | null` and `completed: { sale: Sale; tenderedFils: number | null } | null`.
  - The Cash and Card buttons and F2/F3 now open `PaymentDialog` instead of calling `completeSale` directly.
  - `onComplete` calls `completeSale(...)`.
    - On ok: clear the cart and customer, set `completed`, and close the dialog.
    - On error: show it in the dialog (pass an `error` prop) and keep the cart.
  - **Remove `window.location.assign`.** The cashier stays on `/sale`.
  - While `completed` is set, render `<ReceiptPanel>` in place of the cart. "New sale" clears `completed` and focuses the search input.
  - Shop identity for the receipt comes from `sale.supplier ?? useShopContext().business`, as in `invoice-detail-workspace.tsx`, with `receiptFooter` from the business.

- [ ] **Step 6: Styles** (`app/globals.css`). Add `.payment-dialog .change-due { font-size: 32px; font-weight: 700; }`, `.quick-cash { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }` (each button `min-height: 44px`), and `.receipt-panel` matching `.cart-panel` sizing.

- [ ] **Step 7: Verify**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: PASS.

Then smoke test on local Supabase (dev server on port 3101 from the worktree):
- cash sale of AED 28.50 with 100 received shows change 71.50
- the receipt panel shows the invoice number
- Print 80mm opens the print dialog showing only the receipt
- New sale returns focus to search
- the URL stays `/sale`

- [ ] **Step 8: Commit**

```bash
git add lib/print.ts components/receipt-document.tsx components/pos/payment-dialog.tsx components/pos/receipt-panel.tsx components/invoice-detail-workspace.tsx components/reports-workspace.tsx components/pos-workspace.tsx app/globals.css
git commit -m "feat(pos): payment step with change due and in-place receipt panel"
```

---

### Task 5: Scan-to-add, unknown-barcode offer, per-item discount

**Files:**
- Create: `components/pos/line-discount-dialog.tsx`
- Modify: `components/pos-workspace.tsx`, `components/inventory-workspace.tsx`, `app/globals.css`

**Interfaces:**
- Consumes: `findByCode` (Task 2); `discountedUnit`, `cartTotals`, `parseMoneyInput` (Task 1); `CheckoutLine.listUnitGrossFils` (Task 3)
- Produces: `<LineDiscountDialog line={CartItem} onApply={(unitGrossFils: number) => void} onRemove={() => void} onCancel={() => void} />`

- [ ] **Step 1: Scan-to-add.**
  - Wrap the search input in a `<form onSubmit>`.
  - On Enter, `findByCode(store.products, query)`:
    - **Match:** call the existing `addProduct(product)`, which already increments an existing line and caps at stock. Clear the query, keep focus, and play a short success beep: an 880 Hz, 80 ms Web Audio oscillator in a `beep(ok: boolean)` helper inside the component, wrapped in try/catch. If the product is at its stock limit, show "Only {stock} in stock" and play an error beep.
    - **No match and the query looks like a code** (`/^[0-9A-Za-z-]{4,}$/`): leave the cart unchanged. Show an inline notice "No product with code {code}" plus a link button **Add product** → `/inventory?barcode={encodeURIComponent(code)}`. Play an error beep (220 Hz).
    - **No match and the query is free text:** do nothing; the grid filter already shows matches.
- [ ] **Step 2: Inventory prefill.** In `components/inventory-workspace.tsx`, read `barcode` from `useSearchParams()` (check the Next 16 docs for client usage and Suspense requirements). When present, open the Add product dialog with the barcode field prefilled once. Do not re-open on every render.
- [ ] **Step 3: `components/pos/line-discount-dialog.tsx`.**
  - A segmented choice: **%** or **AED off each**.
  - One input, parsed with `parseMoneyInput` for amounts, or `Number(...)` for percent.
  - Shows the preview "{name}: {list} → {new unit} each".
  - **Apply** calls `onApply(unitGrossFils)` when `discountedUnit(...)` is ok; otherwise it shows the error.
  - **Remove discount** appears when the line is already discounted.
  - Custom (non-stock) lines can be discounted too.
- [ ] **Step 4: Cart line UI.**
  - Each cart line gets a **Discount** button (44px).
  - Discounted lines show the list price struck through, the charged unit price, and "−{saving}".
  - On apply, the line's `listUnitGrossFils` is set to the original price (keep the first original if one is already set) and `unitGrossFils` to the new price.
  - Remove restores `unitGrossFils = listUnitGrossFils` and deletes `listUnitGrossFils`.
  - Cart totals use `cartTotals(cart)`, and a "Discount" summary line shows when `discountFils > 0`.
  - `completeSale` receives `listUnitGrossFils` on each line.
- [ ] **Step 5: Verify**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: PASS.

Smoke test:
- scanning a known barcode twice gives quantity 2
- an unknown code shows the notice and the Add product link opens the inventory dialog prefilled
- 15% off AED 28.50 charges AED 24.23 (2850 × 0.85 = 2422.5, rounded to 2423 fils)
- for a single unit, the receipt shows "was 28.50 · saved 4.27"
- after sync, the server's `sale_items.list_unit_gross_fils` is 2850
- [ ] **Step 6: Commit**

```bash
git add components/pos/line-discount-dialog.tsx components/pos-workspace.tsx components/inventory-workspace.tsx app/globals.css
git commit -m "feat(pos): scan-to-add, unknown-barcode offer and per-item discounts"
```

---

### Task 6: Hold and resume, stale-register guard

**Files:**
- Create: `components/pos/held-carts.tsx`
- Modify: `components/pos-workspace.tsx`, `components/register-workspace.tsx`, `app/globals.css`

**Interfaces:**
- Consumes: `heldCartsKey`, `holdCart`, `resumeCart`, `MAX_HELD_CARTS`, `HeldCart` (Task 2); `staleRegister` (Task 2); `useShopContext().device`
- Produces: `<HeldCarts deviceId={string | null} products={Product[]} canHold={boolean} onHold={() => Omit<HeldCart,"id"|"heldAt">} onResume={(cart: HeldCart, notices: string[]) => void} />`

- [ ] **Step 1: `components/pos/held-carts.tsx`.**
  - Reads and writes `localStorage[heldCartsKey(deviceId)]` as JSON, with every access in try/catch. An unparseable value is treated as `[]`.
  - A **Hold** button (disabled when `!canHold`) calls `onHold()`, then `holdCart(list, cart, crypto.randomUUID(), new Date())`. On ok it saves and the parent clears its cart; otherwise it shows the error.
  - A **Held ({n})** button opens a list showing time held, item count and total (via `cartTotals`) for each cart, with **Resume** and **Discard** (confirm first).
  - Resume calls `resumeCart(list, id, products)`, saves the shortened list, and calls `onResume(cart, notices)`.
  - If the current cart is not empty when resuming, ask "Hold the current sale first?". On yes, hold it, then resume. On no, cancel.
- [ ] **Step 2: Wire into `pos-workspace.tsx`.**
  - `onResume` replaces the cart. Cart item `key`s are `productId ?? crypto.randomUUID()`.
  - It restores `customerId` and shows the notices in the existing error/notice area.
- [ ] **Step 3: Stale-register guard.**
  - In `pos-workspace.tsx`, compute `const stale = staleRegister(store.register, new Date())`.
  - When stale, show `notice error-notice`: "The register opened on {openedOn} is still open. Close it on the Register page before selling." with a link to `/register`.
  - Disable the payment buttons and F2/F3.
  - `register-workspace.tsx` shows the same notice above the close form.
- [ ] **Step 4: Verify**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: PASS.

Smoke test:
- hold a 2-item cart, sell something else, then resume: the cart comes back
- reduce the stock of a held product to 1, then resume: the line is capped with a notice
- set the local register's `openedAt` to yesterday through devtools (`localStorage` hosted cache, then reload): the POS blocks with the notice
- [ ] **Step 5: Commit**

```bash
git add components/pos/held-carts.tsx components/pos-workspace.tsx components/register-workspace.tsx app/globals.css
git commit -m "feat(pos): hold and resume sales; block selling on a stale register"
```

---

### Task 7: Tablet and phone POS layout

**Files:**
- Modify: `app/globals.css`, `components/pos-workspace.tsx`

- [ ] **Step 1: CSS.** Change the existing `@media (max-width: 900px)` rule for `.pos-layout` (currently `grid-template-columns: 1fr`):
  - Keep two columns down to **768px**: `@media (max-width: 900px) and (min-width: 768px) { .pos-layout { grid-template-columns: minmax(0, 1fr) 320px; } .product-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }`.
  - Below 768px, use one column, and the cart panel becomes a **fixed bottom bar**: `.pos-cart-bar { position: fixed; left: 0; right: 0; bottom: <mobile-nav height>; … }`. It shows the item count, total and a **Pay** button; tapping the bar expands the cart as a sheet (`.cart-panel.sheet-open`). Read the existing `.mobile-nav` height in `globals.css` and reserve that space plus the bar in the `.content` bottom padding.
  - Touch targets: `.product-card, .cart-line button, .payment-button, .quick-cash button, .pos-cart-bar button { min-height: 44px; }`, plus `min-width: 44px` for icon buttons.
- [ ] **Step 2: Component.** Add the `pos-cart-bar` element, rendered only by CSS below 768px (`display: none` above), with `sheetOpen` state toggling `sheet-open` on the cart panel.
- [ ] **Step 3: Verify.** Run `npm run lint && npm run build`. Then check in the browser pane at 1366, 820 (tablet) and 375 (phone) widths:
  - tablet keeps the cart beside the products
  - phone shows the bottom bar, the sheet opens and closes, and Pay opens the payment dialog
  - there is no horizontal scroll at 375 (`document.documentElement.scrollWidth === innerWidth`)
- [ ] **Step 4: Commit**

```bash
git add app/globals.css components/pos-workspace.tsx
git commit -m "feat(pos): two-column tablet layout and phone cart bar"
```

---

### Task 8: End-to-end checkout smoke on local Supabase

**Files:** none, unless a defect is found. Each fix gets a failing test first and a `fix:` commit.

- [ ] **Step 1:**
  - Run `supabase db reset`.
  - Create the local test owner, storing credentials only in the worktree's git-ignored `.env.local`.
  - Start the dev server on port 3101 from the worktree.
  - Clear the 3101 origin's storage. **Do not clear cookies**; they are shared with other localhost apps.
- [ ] **Step 2:** Run these checks and record each result:
  1. Set up the shop; add a product with barcode `6291100211014`, price 28.50, stock 10; open the register with 100.
  2. Scan the barcode twice (type it into search and press Enter). Expect quantity 2 and a success beep (no error).
  3. Discount line 1 by 15%. Expect unit 24.23, total 48.46, and the summary "Discount −8.54".
  4. Pay cash with quick amount 50. Expect change 1.54, the receipt panel, "was 28.50 · saved 8.54" (2 units), and the URL still `/sale`.
  5. Check the server: `sale_items.unit_gross_fils = 2423`, `list_unit_gross_fils = 2850`, quantity 2, and `sales.gross_fils = 4846`.
  6. Scan an unknown code `9999999999`. Expect the cart unchanged and the notice with Add product. Following the link opens the inventory dialog with the barcode prefilled.
  7. Hold a cart, then resume it. Then hold again, set stock to 1 through Adjust stock, and resume: the line is capped, with a notice.
  8. Card payment: confirm, see the receipt panel with no change line.
  9. Edit the cached register `openedAt` to yesterday and reload. Checkout is blocked with the stale notice. Close the register, open a new one, and selling works.
  10. At 375px width: the bottom bar shows, Pay works, and there is no horizontal scroll.
- [ ] **Step 3:** Run `npm test`, `npm run test:sql`, `npm run test:rehearsal`, `npm run lint`, `npm run typecheck` and `npm run build`. All must pass. Record "1C smoke passed" with the values observed.

---

## Sub-plan 1C exit criteria

- All suites pass.
- A cashier completes a cash sale with change in under 30 seconds, without leaving `/sale`.
- Discounts are visible on the receipt, the A4 invoice and the server record.
- Scans add or increment instantly. Unknown codes offer to add the product. Held sales resume safely.
- A register from a previous Dubai day blocks selling until it is closed.
- The POS works at desktop, tablet and phone widths with 44px touch targets.
