# Stage 2B: Split payment and bank transfer — design

Date: 2026-11-09. Second sub-project of Stage 2 (Pro tier). Order: 2A staff and PINs (merged) → **2B** → 2C categories and
margin → 2D suppliers and purchase orders → 2E promotions → 2F weighed items → 2G serial/IMEI → 2H advanced reports →
2I digital receipts.

## 1. Goal

A customer can pay one sale with more than one method (some cash, the rest on card or by bank transfer), and any shop
can take a bank transfer for a whole sale. The drawer count stays right: only cash is expected in the drawer.

Success:
- A cashier completes a cash + card + transfer sale, with change on the cash part, in one payment window.
- The register's expected cash, the daily report and the CSV show cash, card and transfer separately, and past days
  show the same figures as before.
- Split sales and refunds work offline and sync whole.

## 2. Owner decisions (from the conversation)

1. **Methods:** cash, card and bank transfer can be mixed on one sale.
2. **Refunds of any sale:** the cashier picks any mix of methods; no limit per method.
3. **Plans:** every plan gets bank transfer as a single payment method; splitting one sale or refund across methods is
   Pro (`split_payment`). The Founding 50 offer (separate work) gives founders Pro features, including this.
4. **Storage:** one payment row per method used.

Assumptions stated and not corrected:
- A bank transfer may carry an optional reference (up to 60 characters).
- Change is worked out on the cash part only.
- Only cash counts toward the drawer; card and transfer are reported on their own lines.
- Sales and refunds made before 2B keep their single method.

## 3. What already exists

- `payment_method` enum (`cash`, `card`) on `sales` and `credit_notes`; `Sale.paymentMethod` and `CreditNote.paymentMethod`
  in `lib/domain.ts`; refunds copy the sale's method today.
- `apply_sale_sync` (latest in `202610190024_register_access_gate.sql`) and `apply_credit_note_sync` (latest in
  `202610130016_tills_and_sync_device.sql`) insert sales and credit notes from the till's payload.
- `lib/store/register-totals.ts` sums cash and card by each document's single method; `lib/reporting.ts`, the overview,
  the sales list and search (`search_sales`), the customer page and `receipt-document.tsx` read `paymentMethod`.
- `components/pos/payment-dialog.tsx`: cash (amount received, change due, quick amounts) or card (confirm).
- Row security: members see sales and credit notes through `member_sees_sale`; the owner sees all.
- Stage 1 rule: an issued invoice is never turned down at sync for plan reasons.

## 4. Data and server

### 4.1 Methods

- Add `transfer` and `split` to the `payment_method` enum.
- `split` appears only as a sale's or credit note's summary method, never on a payment row.

### 4.2 Payment rows

New tables `sale_payments` and `credit_note_payments`:

| column | type | rule |
|---|---|---|
| `id` | uuid | primary key (from the till) |
| `business_id` | uuid | the document's business |
| `sale_id` / `credit_note_id` | uuid | references the document, cascade not allowed (documents are never deleted) |
| `method` | `payment_method` | `cash`, `card` or `transfer` (check: not `split`) |
| `amount_fils` | bigint | greater than 0 |
| `reference` | text, null | only for `transfer`; at most 60 characters |
| `created_at` | timestamptz | the document's time |

- Unique `(sale_id, method)` and `(credit_note_id, method)`: at most one row per method per document.
- The rows of one document add up exactly to its `gross_fils`.
- Row security mirrors the document: readable when the member can read the sale (`member_sees_sale`) or the credit
  note; owner reads all; no direct writes (sync functions only).

### 4.3 Summary method

`sales.payment_method` and `credit_notes.payment_method` keep a one-word summary: the single method used, or `split`.
Existing readers that only need a label keep working.

### 4.4 Backfill

Every existing sale and credit note gets one payment row: its current method for its full `gross_fils`. Totals and
past reports do not change.

### 4.5 Sync

`apply_sale_sync` and `apply_credit_note_sync` are redefined to read an optional `payments` array from the record:
`[{ id, method, amountFils, reference? }]`.

- The rows are inserted in the same transaction as the document (money is never half-saved).
- No `payments` array (a till on an older app version): one row from the record's `paymentMethod` for the full total.
- Checks, raising P0001 `payments_mismatch` and saving nothing: amounts are positive whole fils, methods are cash, card
  or transfer, at most one row per method, the sum equals the document's gross, and the summary method matches
  (one row → that method; two or more → `split`).
- No plan check on the server: the till enforces `split_payment` (Stage 1 rule above).
- Retried operations: the existing operation-id idempotency covers the payment rows with their document.

The request schema (`lib/sync/request-schema.ts`) accepts `payments` on sales and credit notes and `transfer` / `split`
as methods.

### 4.6 Snapshot

Each sale and credit note in the snapshot carries its payment rows (`payments: [{ method, amountFils, reference }]`).

## 5. The till

### 5.1 Payment buttons (New sale)

- **Cash (F2)** and **Card (F3)**: as today.
- **Bank transfer (F4)**, every plan: confirms the total, with an optional "Transfer reference" field.
- **Split (F6)**, Pro: opens the Split window. On Starter it shows the existing "Part of Pro" prompt.

### 5.2 Split window

- A line each for Cash, Card and Bank transfer with an amount; the transfer line also has its reference.
- "Left to pay" updates live; "Rest on cash / card / transfer" fills one line with what is left.
- With a cash line, "Cash received" shows change due on the cash part only (existing change rules).
- Complete is enabled only when "Left to pay" is exactly 0 and every used line is more than 0.
- A note under the card line: take this amount on the card machine.

### 5.3 Receipts and invoices

Each payment is listed ("Cash 50.00 · Card 27.20 · Change 0.00"); a transfer shows its reference.

### 5.4 Refunds

The refund window gains "Pay back by", prefilled with the original method for the full refund. Pro: any mix of cash,
card and transfer that adds up to the refund total, with no limit per method. Starter: one method of the three.

### 5.5 With the 2A PIN lock

A split needs no extra approval. A discount approval still happens before the payment window opens; refunds still
need a manager when the operator is a cashier.

## 6. Register, reports and lists

- **Register:** totals come from payment rows, still only for documents from this till.
  Expected cash = opening float + cash sale payments − cash refund payments + cash adjustments. Card and transfer
  show on their own lines and never count as drawer cash. The close variance stays cash only.
- **Daily report and Reports:** cash, card and transfer shown separately (sales, refunds, net), from payment rows.
  The CSV adds transfer columns; existing column names do not change.
- **Sales list and search:** method label Cash, Card, Transfer or Split; split parts show on hover and on the invoice.
  The method filter gains Transfer and Split.
- **Overview:** the cash and card figures add transfer, from payment rows. Customer lifetime spend is unchanged.

## 7. Offline and errors

- Split sales and refunds work offline; payment rows travel inside the document's outbox payload.
- The Pro check uses the till's cached entitlements; a completed offline sale is never undone if the plan changed.
- Till: Complete stays off until the parts add up; amounts more than 0; one line per method; references cut to
  60 characters before sending.
- Sync: `payments_mismatch` turns the record down; it shows in Settings → Data as a failed change and stays on the till.

## 8. Testing

- **Unit:** split maths (left to pay, rest-on buttons, change on cash only); register totals with mixed payments;
  report totals per method; refund mixes; converting payments to the sync payload; summary method.
- **SQL (two tenants):** a matching payment list is saved with the sale; a mismatching one is refused with
  `payments_mismatch` and nothing saved; a sale without `payments` gets one row; backfilled rows equal each old
  document's total; the other shop cannot read the rows; per-method sums equal document totals.
- **Browser:** cash + card + transfer split with change; a split refund; register close shows the right expected
  cash; an offline split that syncs later; Starter sees the Pro prompt on Split but can take a bank transfer.

## 9. Out of scope

Card terminal integration; store credit and customer accounts (Stage 4); more than one line of the same method on a
sale; partial payments or deposits across days; a separate transfer-confirmation workflow.

## 10. Open items

- Whether the daily CSV should also gain one row per payment (an "export payments" option) for accountants.
