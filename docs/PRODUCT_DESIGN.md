# Product Design Specification

## Design direction

The interface uses premium utilitarian minimalism: a warm bone canvas, white work surfaces, charcoal text, crisp one-pixel borders, almost no shadows, restrained pastel status colors, and strong typographic hierarchy. The POS prioritizes speed and legibility over decoration.

Primary UI typeface: Geist Sans or Helvetica Neue.  
Numeric/meta typeface: Geist Mono.  
No gradients, glass effects, oversized rounded containers, thin generic icons, or decorative animation.

## Navigation

Desktop navigation is a fixed 232px left rail with the shop name, register status, primary destinations, connection state, and operator actions. Mobile/tablet navigation collapses to a compact top bar and drawer.

Destinations:

1. Overview
2. New sale
3. Sales
4. Inventory
5. Customers
6. Register
7. Reports
8. Settings

## Screen specifications

### Overview

- Date and register status at the top.
- Four restrained metrics: today's gross sales, Cash, Card, and VAT.
- Primary action to start a new sale.
- Low-stock list and recent invoices.
- Pending-sync warning occupies a visible but non-blocking status band.

### New sale

- Two-column desktop layout: product browser on the left and cart/payment panel on the right.
- Search receives focus on entry and accepts scanner keyboard input.
- Product rows show name, SKU, available quantity, and VAT-inclusive price.
- Cart rows use large quantity controls and visible line totals.
- Checkout total remains anchored at the bottom of the cart.
- Cash and Card are explicit buttons; no hidden payment menu.

### Inventory

- Table with product, SKU/barcode, stock, threshold, price, and status.
- Low-stock values use pale red; healthy stock uses neutral text.
- Product create/edit and stock adjustment use focused side panels or dialogs.
- Stock history is an immutable timeline with movement type, quantity delta, reason, and reference.

### Customers and sales

- Searchable tables with compact filters and readable empty states.
- Customer detail shows contact information followed by the invoice/credit-note ledger.
- Invoice detail clearly separates immutable fiscal data from available actions such as Print, Download PDF, and Create credit note.

### Register and reports

- Closed state emphasizes opening the register.
- Open state shows opening balance, expected cash, Cash/Card totals, refunds, and adjustments.
- Closing is a short counted-cash form followed by an explicit variance confirmation.
- Daily report uses a flat grid and a payment/VAT breakdown, not decorative charts.

## Invoice layouts

### 80mm receipt

- Centered shop identity followed by the words "Tax Invoice".
- Invoice number, issue date/time, supply date, and optional customer/TRN.
- Item description, quantity, unit price, and gross line amount.
- Net total, VAT 5%, gross total, payment method, and receipt footer.
- Print CSS removes app chrome and uses a printer-safe system font.

### A4 PDF

- Supplier and customer blocks at the top.
- Invoice metadata and line-item table.
- AED net, VAT, and gross summary aligned consistently.
- Page number and invoice number repeat on multi-page documents.

## States and interaction rules

- Empty states explain the next action in one sentence and expose one primary button.
- Destructive or fiscal actions require confirmation with a plain-language consequence.
- Completed invoices have no Edit or Delete action.
- Offline mode uses a pale-yellow status treatment. Failed sync uses pale red. Synchronized uses pale green.
- Motion is limited to opacity/transform transitions of 150–250ms and respects reduced-motion preferences.
- Minimum interactive target size is 44px on the POS.

## Wireflow

Onboarding -> Register till -> Add product/opening stock -> Open register -> New sale -> Cash/Card -> Print/PDF -> Daily report -> Close register.

Return flow: Sales -> Invoice detail -> Create credit note -> Select return quantities -> Confirm refund method -> Credit note/stock restoration.
