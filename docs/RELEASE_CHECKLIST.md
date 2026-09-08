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

## Rollback

1. Keep the previous hosting deployment available.
2. If the application fails but the database is healthy, route traffic to the previous deployment.
3. Do not reverse an applied fiscal migration destructively. Ship a forward corrective migration.
4. If data is damaged, stop checkout, preserve logs and local outboxes, and restore Supabase into a separate recovery project first.
5. Reconcile invoice numbers and pending operations before reopening the till.

Release approval requires the business owner, technical owner, and tax adviser sign-off. Any failed fiscal, backup, RLS, or printer gate blocks launch.
