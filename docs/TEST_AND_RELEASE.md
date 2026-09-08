# Test and Release Plan

## Test layers

### Unit

- VAT-inclusive line rounding and document totals.
- Credit-note proportional values and return limits.
- Register expected cash and variance.
- Invoice-number range allocation and exhaustion.
- Stock availability including pending offline deltas.
- Asia/Dubai business-date boundaries.

### Integration

- Checkout commits sale, payment, register, stock, sync, and audit records atomically.
- Replaying an operation ID returns the original result without duplicates.
- Concurrent/invalid operations cannot oversell stock or reuse an invoice number.
- Credit notes restore stock and reverse the correct payment totals.
- RLS prevents access outside the authenticated business.
- Daily report totals reconcile with underlying immutable records.

### End to end

- Owner onboarding and till registration.
- Product creation, opening stock, and adjustment history.
- Register open, Cash sale, Card sale, full customer invoice, and close.
- Partial and full return using credit notes.
- Offline sale, refresh, reconnect, retry, and exactly-once synchronization.
- 80mm print and A4 PDF generation.

### Visual and accessibility

- Desktop POS at 1366x768 and 1920x1080.
- Tablet layout at 1024x768.
- Keyboard-only checkout, visible focus, labels, error announcements, and contrast.
- Receipt/PDF cases: long names, many items, large totals, missing optional customer fields, full invoice, and credit note.

## UAT script

The owner performs a complete simulated business day with representative products: opening stock, opening cash, Cash and Card invoices, customer invoice, stock correction, return, report review, counted close, and invoice reprint. The owner also disconnects the network for one sale and confirms successful recovery.

## Definition of Done

- Acceptance criteria are automated where practical and manually verified otherwise.
- Type checking, linting, unit/integration tests, and production build pass.
- New fiscal/data behavior includes audit and failure handling.
- Empty, loading, error, and offline states are implemented.
- Documentation and migrations match deployed behavior.
- No critical or high-severity defect remains open.

## Release gates

- Business owner approves the PRD and workflows.
- UAE tax adviser approves invoice fields, wording, and VAT treatment.
- Target 80mm printer and A4 PDF are visually verified.
- Backup restoration succeeds in a non-production environment.
- Security/RLS tests pass.
- UAT is signed off and production environment variables are validated.

## Rollout and monitoring

- Deploy preview continuously; promote the approved commit to production.
- Seed no demonstration transactions in production.
- Monitor authentication failures, API errors, PDF failures, failed sync operations, and stock anomalies.
- Keep the previous deployment available for application rollback. Database changes use forward-compatible migrations and documented recovery steps.
