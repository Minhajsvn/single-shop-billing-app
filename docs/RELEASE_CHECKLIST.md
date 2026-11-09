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

## Rollback

1. Keep the previous hosting deployment available.
2. If the application fails but the database is healthy, route traffic to the previous deployment.
3. Do not reverse an applied fiscal migration destructively. Ship a forward corrective migration.
4. If data is damaged, stop checkout, preserve logs and local outboxes, and restore Supabase into a separate recovery project first.
5. Reconcile invoice numbers and pending operations before reopening the till.

Release approval requires the business owner, technical owner, and tax adviser sign-off. Any failed fiscal, backup, RLS, or printer gate blocks launch.
