# MVP Release Checklist

## Automated evidence

- [ ] `npm run test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run lint` passes without warnings.
- [ ] `npm run build` produces the production bundle.
- [ ] Production responses include CSP, clickjacking, MIME, referrer, and permissions headers.
- [ ] Supabase migrations apply successfully in staging.
- [ ] RLS tests prove one business cannot read or mutate another business's records.

## Business acceptance

- [ ] Legal business name, UAE TRN, registered address, phone, prefix, and footer are approved.
- [ ] UAE tax adviser approves simplified/full invoice wording and VAT treatment.
- [ ] Representative product list is imported and checked.
- [ ] The actual 80mm printer passes `PRINTER_TEST_MATRIX.md`.
- [ ] A4 PDF output is approved.
- [ ] The owner completes the full simulated business-day journey in `TEST_AND_RELEASE.md`.
- [ ] The backup/restore drill passes.

## Environment and deployment

- [ ] Supabase production project, region, owner account, and managed backups are configured.
- [ ] Public Supabase URL/key are set in hosting; service-role credentials remain server-only.
- [ ] HTTPS production domain and error monitoring are configured.
- [ ] Demo seed data is disabled in production.
- [ ] Database migrations are applied before promoting the application build.
- [ ] Smoke test covers sign-in, register open, Cash sale, Card sale, print, report, and backup.

## Stage 2A: staff roles and cashier PINs

- [ ] Apply migrations in order before the app build: `202611080044_staff_pins`, `202611080045_staff_functions`,
  `202611080046_sync_operator`, `202611080047_staff_list`, `202611080048_operator_sync_entity_id`.
- [ ] `npm run test:sql` passes against staging (includes `supabase/tests/staff_pins_test.sql`).
- [ ] The Supabase invite email template and redirect (`/auth/confirm?next=/reset-password`) work for staff invites.
- [ ] Nothing changes for existing shops until an owner turns on the PIN lock in Settings → Staff (Pro only, owner PIN first).
- [ ] Smoke test on a Pro shop: invite a cashier and a manager, set PINs, turn the lock on, sell as the cashier, approve a
  refund and a register close with the manager's PIN, and check both names on the records.
- [ ] Note for support: a PIN only says who is at the till; the shop's sign-in protects the data. Five wrong PINs block that
  person on that till for five minutes.

## Stage 2B: split payment and bank transfer

- [ ] Apply migrations in order: `202611090049_payment_methods`, `202611090050_payment_rows`,
  `202611090051_sync_with_payments`. They are safe before the app deploy: the current app keeps calling the old sync
  functions, and 050 backfills one payment row for every existing sale and refund.
- [ ] Deploy the 2B app only after 051 is applied: it calls `apply_sale_sync_with_payments` and
  `apply_credit_note_sync_with_payments`.
- [ ] After the backfill, check that every sale and credit note is covered:
  `select count(*) from sales s where gross_fils <> (select coalesce(sum(amount_fils),0) from sale_payments where sale_id = s.id)` returns 0.
- [ ] Smoke test on a Pro shop: a cash + card split with change, a bank transfer with a reference, a split refund, and
  the register close showing only cash as expected; on a Starter shop, Split shows the Pro prompt and Bank transfer works.
- [ ] Tell accountants about the three new CSV columns (Cash AED, Card AED, Transfer AED) after the existing ones.

## Stage 2C: categories and margin (and a 2B drawer fix)

- [ ] Before applying 054, confirm no deployed code selects `*` from `products`, `sale_items` or `credit_note_items` as a
  member: 054 hides the cost columns with column privileges, so such a query would fail.
- [ ] Apply migrations in order: `202611100053_categories`, `202611100054_product_cost`, `202611100055_sync_cost_stamp`,
  `202611100056_split_cash_drawer`. They are safe before the app deploy: the current app ignores the new columns and
  calls the same sync function names; cost stamping starts once 055 is applied.
- [ ] 056 fixes Stage 2B: the cash part of a split sale or refund now counts in the drawer (closing a register with
  split cash was refused with `register_expected_cash_mismatch`). Apply it before or with the 2B app deploy. It also
  backfills open registers; closed registers keep the figures they closed with.
- [ ] Deploy the 2C app after 056.
- [ ] Smoke test on a Pro shop: add categories, set a cost (owner), sell, and check the Profit tab; a manager sees costs
  read-only; a PIN cashier sees no cost and no Profit tab; the till's category chips work offline; on Starter the
  Profit tab shows the Pro card and costs are hidden.
- [ ] Note for support: sales made before 2C have no cost and show in the "no cost" banner; profit counts synced sales
  only; a product's category is its current one, so moving a product moves its past sales too.

## Stage 2D: suppliers and deliveries

- [ ] Apply migrations in order: `202611110057_suppliers`, `202611110058_purchase_receipts`. Nothing existing changes, so
  they are safe before the app deploy.
- [ ] Deploy the 2D app after 058.
- [ ] Smoke test on a Pro shop: add a supplier; record a delivery by scanning (a second scan adds 1); check stock and the
  new average cost on Inventory and the margin on the Profit tab; the same supplier invoice again is refused; void the
  delivery (stock goes back out, cost stays); a manager sees Purchases and Reports; a cashier has no Purchases; on
  Starter, Purchases shows the Pro card.
- [ ] Note for support: the average cost uses the stock the server knows, so sales still waiting in a till's outbox are
  not counted; voiding a delivery never changes cost (set it by hand if needed); a void is refused once too much of the
  delivery has been sold.
- [ ] Tell accountants about the purchases CSV (Purchases → Download CSV): supplier TRN, invoice no., net, VAT, gross.

## Stage 2E: promotions

- [ ] Apply migration `202611120059_promotions` (replaces the sale wrapper, keeping 2C cost stamping and the 056 split
  cash fix). Safe before the app deploy: older tills send no promotion fields, so those stay empty.
- [ ] Deploy the 2E app after 059.
- [ ] Smoke test on a Pro shop: create each kind (percent, AED off, buy N get M, N for P, basket over a threshold, one
  with days and hours); sell at the till online and offline; check the cart's "Promotions −AED x", the receipt's per-line
  promotion and "You saved"; refund one promoted item (it returns the price charged); see the Results tab; on Starter the
  till charges list prices and Promotions shows the Pro card.
- [ ] Note for support: tills pick up promotion changes within about 5 minutes (or when the tab regains focus); a till
  offline since a change keeps the old rules until it reconnects. A "free" item is never a zero line: the saving is spread
  over the group, so lines can show prices like 21.34 and 21.33.

## Rollback

1. Keep the previous hosting deployment available.
2. If the application fails but the database is healthy, route traffic to the previous deployment.
3. Do not reverse an applied fiscal migration destructively. Ship a forward corrective migration.
4. If data is damaged, stop checkout, preserve logs and local outboxes, and restore Supabase into a separate recovery project first.
5. Reconcile invoice numbers and pending operations before reopening the till.

Release approval requires the business owner, technical owner, and tax adviser sign-off. Any failed fiscal, backup, RLS, or printer gate blocks launch.
