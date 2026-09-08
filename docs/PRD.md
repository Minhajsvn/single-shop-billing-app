# Product Requirements Document

## Product

Working name: Shop Ledger UAE  
Release: MVP 1.0  
Market: Single-location UAE retail shop  
Currency and timezone: AED, Asia/Dubai

## Problem

Small shops need one dependable place to issue tax invoices, track stock, understand daily sales, and reconcile the cash drawer. Spreadsheet- or paper-based workflows make VAT totals, returns, stock corrections, and end-of-day balancing slow and error-prone.

## Goal

Provide a fast, installable point-of-sale application for one shop and one registered till. A normal sale should update the invoice ledger, stock, payment totals, and daily register as one auditable operation, including during a short internet outage.

## Primary user

The owner/operator manages products and settings and also works as the cashier. Separate employee roles and permissions are outside the MVP.

## Success measures

- Complete a normal sale within 30 seconds after the items are selected.
- Produce matching receipt, invoice, VAT, stock, and register totals without manual correction.
- Reconcile and close the register within five minutes.
- Never create duplicate fiscal, payment, or stock records after a sync retry.
- Surface every product at or below its low-stock threshold.

## Functional requirements

### Setup and access

- The owner signs in with email and password, configures legal shop details, and registers one till.
- Daily till access uses a rate-limited PIN. Sensitive settings require owner reauthentication.
- Required shop fields are legal name, address, TRN, phone, receipt footer, and invoice prefix.

### Products and inventory

- Products contain name, SKU, optional barcode, VAT-inclusive price, on-hand quantity, low-stock threshold, and active status.
- SKUs and non-empty barcodes are unique within the shop.
- Quantities are whole numbers. Weighted products, variants, and serial numbers are excluded.
- Stock changes are immutable movements: opening stock, receipt, correction-in, correction-out, sale, and return.
- Negative stock is blocked. Every manual movement requires a reason.

### Register

- Only one register session may be open for the till.
- Opening requires a counted cash balance.
- The register records cash sales, cash refunds, and reasoned cash adjustments.
- Closing records counted cash and calculates expected cash and variance.
- Card totals are reported separately and do not affect physical drawer cash.

### Checkout and billing

- An open register is required before checkout.
- Products can be found by search, SKU, or barcode. The cart supports quantity changes and controlled non-stock custom lines.
- Payment methods are Cash and Card. Card payment occurs on an external terminal.
- Prices include 5% VAT. Money is stored as integer fils; net and VAT values are persisted per line.
- Completing a sale atomically creates the immutable invoice, items, payment, stock movements, and register entry.
- Consumer sales use a simplified tax invoice. Selecting a customer with a TRN produces a full tax invoice.
- Output formats are an 80mm print receipt and an A4 PDF generated from the same invoice snapshot.

### Customers and corrections

- Customers contain name, phone, email, address, and optional TRN.
- Customer history lists invoices and credit notes chronologically.
- Completed invoices cannot be edited or deleted.
- Returns create a linked credit note, restore returned stock, and create the appropriate cash or card reversal.

### Reports and alerts

- The daily report includes invoice count, gross sales, net sales, VAT, Cash/Card totals, credit notes, register opening/closing values, and variance.
- Reports can be printed and exported as CSV.
- Low-stock items appear on the dashboard and inventory screen. External notifications are excluded.

### Limited offline operation

- The registered till caches shop settings, the active catalog, the current register, reserved invoice numbers, and a limited recent-customer index.
- Opening/closing the register and checkout remain available during a short outage.
- Offline operations are queued with stable operation IDs and synchronized idempotently.
- The displayed and printed invoice number never changes after checkout.
- Offline checkout is disabled if the reserved invoice-number range is exhausted.

## Non-functional requirements

- Current Chrome and Edge on the registered shop computer are supported.
- All business tables enforce row-level access policies.
- Server secrets never enter the browser bundle.
- Locally cached customer data is minimized and protected with a device-bound Web Crypto key.
- Business dates use Asia/Dubai rather than the browser's local timezone.
- Core checkout actions provide clear loading, success, offline, pending-sync, and failure states.
- Keyboard navigation, visible focus, semantic labels, and WCAG AA contrast are required.

## Acceptance journeys

1. Configure the shop, register the till, create a product, and receive opening stock.
2. Open the register, complete one Cash sale and one Card sale, and print both invoices.
3. Attach a TRN-bearing customer and produce a full tax invoice.
4. Return an item through a credit note and confirm stock and payment totals reverse correctly.
5. Complete a sale offline, reconnect, and confirm it synchronizes exactly once.
6. Review the daily summary, count the drawer, close the register, and verify the variance.

## Exclusions

Supplier management, purchase orders, expenses, accounts payable, accounting integrations, integrated card processing, split tender, multi-shop, multiple active tills, employee roles, e-commerce, weighted goods, variants, serial numbers, and live Accredited Service Provider integration.

## Compliance note

The implementation will retain the structured supplier, buyer, line, tax, and invoice fields needed for a future UAE e-invoicing adapter. Final invoice wording and tax treatment must be approved by the business's UAE tax adviser before production use.
