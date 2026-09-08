# Technical Design

## Architecture

- Next.js 16 App Router with TypeScript and Tailwind CSS 4.
- Supabase Auth and PostgreSQL for hosted identity and data.
- Row Level Security scopes all business-owned records to the authenticated owner.
- IndexedDB stores the offline bootstrap snapshot, active register, number reservations, encrypted customer subset, and queued operations.
- Vercel hosts the application and server endpoints.
- Server-side PDF rendering creates the A4 invoice; CSS print media handles the 80mm receipt.

## Domain model

- `businesses`: legal identity, TRN, address, phone, timezone, invoice prefix, receipt footer.
- `devices`: registered till, public identifier, status, last seen, number-range cursor.
- `products`: SKU, barcode, name, VAT-inclusive unit price in fils, stock quantity, threshold, status.
- `stock_movements`: immutable signed quantity, type, reason, product, sale/credit reference, operation ID.
- `customers`: contact fields, address, optional TRN.
- `register_sessions`: device, business date, opening cash, expected cash, counted cash, variance, status.
- `cash_movements`: immutable register effect with type, amount, reason, and source reference.
- `sales`: immutable invoice snapshot, customer snapshot, totals, payment method, sync state.
- `sale_items`: product/custom snapshot, quantity, unit gross, net, VAT, and gross totals.
- `credit_notes` and `credit_note_items`: immutable reversal documents linked to a sale.
- `invoice_number_ranges`: server-reserved inclusive ranges assigned to one device.
- `sync_operations`: unique operation ID, version, device, kind, payload hash, result, and processed timestamp.
- `audit_events`: actor, action, entity, entity ID, summary, and timestamp.

All primary identifiers are UUIDs. Timestamps are stored in UTC; business-date derivation uses Asia/Dubai.

## Fiscal calculations

- Inputs and stored totals use integer fils.
- For a VAT-inclusive gross line amount `G`, net is `round(G * 100 / 105)` and VAT is `G - net`.
- Calculations occur per line after multiplying unit price by quantity.
- Document totals sum persisted line values; totals are never recalculated from current product data.
- Credit notes copy the original fiscal values proportionally to returned whole quantities.

## Transaction boundaries

Checkout runs in one database transaction:

1. Claim the operation ID and reject/replay an existing result idempotently.
2. Validate business, device, open register, invoice number, product status, and stock.
3. Insert the immutable sale and line snapshots.
4. Insert payment/register effects.
5. Insert stock movements and update materialized product quantities.
6. Store the operation result and audit event.

Credit-note processing uses the same pattern and prevents returned quantity from exceeding the sold quantity minus previous returns.

## API contracts

- `GET /api/v1/bootstrap`: business settings, device, catalog, current register, recent customers, and number reservation.
- `POST /api/v1/invoice-ranges/reserve`: atomically assigns the next range to the registered device.
- `POST /api/v1/sync`: accepts an ordered batch of versioned operations and returns per-operation success or actionable failure.
- `GET /api/v1/invoices/:id/pdf`: returns the immutable A4 PDF.
- `GET /api/v1/reports/daily?date=YYYY-MM-DD&format=json|csv`: returns authorized daily totals.

Operation envelope:

```ts
type SyncOperation = {
  version: 1;
  operationId: string;
  deviceId: string;
  kind: "register.open" | "register.close" | "sale.complete";
  clientCreatedAt: string;
  payload: unknown;
};
```

Administrative product/customer/settings mutations use authenticated server actions and are unavailable offline.

## Offline model

- Online bootstrap replaces cached server data only after a successful complete response.
- A local sale stores its invoice snapshot and stock deltas before showing success.
- The queue processes FIFO, but every operation remains independently idempotent.
- Pending stock equals cached server stock plus unsynchronized local deltas.
- Validation failures remain visible and never silently discard a sale.
- Cache schema changes are versioned with explicit IndexedDB migrations.

## Security and recovery

- Owner passwords remain managed by Supabase Auth.
- Till PINs are slow-hashed on the server; offline verification uses a rate-limited device-bound verifier.
- Customer cache fields are encrypted with a non-exportable Web Crypto key.
- Service-role credentials are server-only.
- Content Security Policy, secure cookies, input schemas, CSRF-safe server actions, and rate limits apply.
- Production requires managed database backups and a tested restore procedure.

## Future ASP adapter

The invoice domain emits a normalized fiscal document after commit. A future adapter may transform eligible B2B/B2G documents into the selected Accredited Service Provider's required UAE e-invoice format without changing checkout or historical invoice records.
