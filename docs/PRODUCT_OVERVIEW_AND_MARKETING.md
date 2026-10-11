# Shop Ledger UAE — Product Overview and Marketing Brief

This document describes what Shop Ledger UAE is, what it does today, and what a digital or social media marketing team needs to know to promote it accurately. Technical detail lives in the [PRD](PRD.md), [Product design](PRODUCT_DESIGN.md), and [Technical design](TECHNICAL_DESIGN.md).

## Short description

**Shop Ledger UAE** is a fast, installable point-of-sale and billing app for a single UAE retail shop. It lets the owner sell, print VAT-compliant tax invoices, track stock, manage customers and returns, and balance the cash drawer at the end of the day — all from one browser-based app that keeps working through short internet outages.

### Taglines (pick and test)

- "Sell, bill, and close the day — in one place."
- "VAT-ready billing for UAE shops."
- "Your shop's ledger, invoices, and cash drawer, finally in sync."
- "Built for the counter: fast checkout, clean invoices, zero spreadsheet stress."

### One-paragraph pitch

Small UAE shops often run on paper receipts, spreadsheets, and a cash drawer that never quite balances. Shop Ledger UAE replaces that with one dependable app: every sale automatically produces a 5% VAT tax invoice, updates stock, and records the payment in the day's register. At closing time the owner sees exactly what was sold, how much VAT was collected, how much cash should be in the drawer, and any difference — in under five minutes.

## Who it is for

| Audience | What they care about |
|---|---|
| **Owner-operators** of a single shop who also work the till (primary user) | Speed at the counter, correct VAT, knowing the day's cash |
| Grocery, specialty food, gift, stationery, mobile-accessory, cosmetics and similar fixed-price retail shops | Simple products with SKU/barcode, no weighing or variants |
| Shops selling to both walk-in consumers and businesses | Simplified invoices for consumers, full tax invoices for TRN-registered customers |
| Owners moving off paper or spreadsheets | Low learning curve, no special hardware required |

Not a fit (today): multi-branch chains, shops needing several tills or staff logins, restaurants, weighted goods (e.g. loose produce by kg), products with size/colour variants, e-commerce, or integrated card processing.

## Feature list

### Checkout and billing
- Fast checkout: find products by name, SKU, or barcode; works with keyboard-wedge barcode scanners.
- Keyboard shortcuts for speed: `/` to search, `F2` to take Cash, `F3` to take Card.
- Prices are VAT-inclusive; 5% UAE VAT is calculated and stored per line automatically.
- Cash and Card payments (card is taken on the shop's existing card terminal).
- **Simplified tax invoice** for walk-in customers; **full tax invoice** automatically when a customer with a TRN is selected.
- Print an **80mm thermal receipt** or an **A4 invoice/PDF** from the same invoice record.
- Custom shop details on every invoice: legal name, address, TRN, phone, invoice prefix, and receipt footer message.
- Completed invoices are locked — no edits or deletions — for a clean audit trail.

### Inventory
- Product catalogue with SKU, optional barcode, price, stock on hand, and low-stock threshold.
- Stock updates automatically with every sale and return.
- Every manual stock change (receipt, correction) requires a reason and is kept in an immutable history.
- Negative stock is blocked.
- Low-stock alerts on the dashboard and inventory screen.

### Customers and returns
- Customer records with name, phone, email, address, and optional 15-digit TRN.
- Per-customer purchase history and lifetime spend.
- Returns create a linked **credit note**, restore stock, and record the refund — the original invoice is never altered.

### Cash register and reports
- Open the day with a counted cash float; close it with a counted total.
- Automatic expected-cash calculation and **variance** (over/short) at close.
- Card totals tracked separately from physical cash.
- Daily report: invoice count, gross and net sales, VAT, cash vs card, credit notes, register figures.
- Print the report or **export to CSV** (opens in Excel / Google Sheets).
- Business dates follow Dubai time (Asia/Dubai), not the computer's clock settings.

### Reliability, privacy, and convenience
- **Installable app (PWA)** — runs in Chrome or Edge and can be installed like a desktop app.
- **Keeps selling during short internet outages**; queued work is synced once when the connection returns, with no duplicate invoices.
- Locally stored customer data is encrypted on the device.
- One-click **JSON backup and restore** of the shop's data.
- Responsive layout for desktop, tablet, and mobile, with keyboard navigation and accessible contrast.

## Current product status (read before publishing anything)

Marketing must match what the product actually does. As of this document:

- **Ready:** all MVP features above work in the app, which currently stores its working data on the shop device.
- **Not yet live:** hosted cloud sync and production rollout. The Supabase backend foundations exist, but real hosted synchronization is disabled until credentials, server functions, and release approvals are in place. Do not advertise "cloud", "access from anywhere", or "multi-device" yet.
- **Tax wording:** final invoice wording and tax treatment must be approved by the business's UAE tax adviser before production use. Say "VAT-ready" or "built for UAE 5% VAT", not "FTA-approved" or "FTA-certified".
- **E-invoicing:** invoice data is structured for a future UAE e-invoicing adapter, but there is **no live Accredited Service Provider integration**. Do not claim e-invoicing compliance.
- **Language:** the interface is English only. No Arabic UI or bilingual invoices yet.
- **Single shop, single till, single user (owner).** No staff accounts or multi-branch support.

### Claims to avoid

| Avoid | Use instead |
|---|---|
| "FTA-approved / certified" | "Built for UAE 5% VAT invoicing" |
| "E-invoicing compliant" | "Structured for future UAE e-invoicing" (only if needed) |
| "Works fully offline" | "Keeps selling through short internet outages" |
| "Cloud-based / access anywhere" | "Installable app for your shop computer" |
| "Accepts card payments" | "Records card payments from your existing terminal" |
| "Arabic & English" | (omit until Arabic is shipped) |
| "Unlimited staff / branches" | "Made for one shop and one till" |

## Key benefits to lead with

1. **Speed at the counter** — target of under 30 seconds per sale once items are selected.
2. **VAT done for you** — every invoice shows net, VAT 5%, and gross automatically.
3. **The drawer balances** — close the register in about five minutes and see any variance instantly.
4. **Know your stock** — low-stock items surface before you run out.
5. **Professional invoices** — thermal receipts for walk-ins, A4 tax invoices for business customers.
6. **No drama when the internet drops** — keep serving customers.
7. **Clean records** — locked invoices, credit notes for returns, CSV exports for your accountant.

## Content ideas for social media

Short-form video / Reels / TikTok
- "A full sale in under 30 seconds" — screen recording: scan, `F2`, print receipt.
- "Closing the shop in 5 minutes" — count drawer, close register, see variance.
- "Internet down? Keep selling." — show the offline status band and a completed sale.
- "Walk-in vs business customer" — same cart, simplified vs full tax invoice.
- Before/after: paper receipt book and calculator vs the Overview dashboard.

Carousels / static posts
- "5 signs your shop has outgrown spreadsheets."
- "What must appear on a UAE tax invoice?" (educational; have the tax adviser review).
- "Simplified vs full tax invoice — what's the difference?"
- Feature spotlights: low-stock alerts, credit-note returns, daily CSV report.
- Keyboard shortcut cheat sheet for cashiers.

LinkedIn / longer posts
- The problem story: an owner reconciling VAT and cash by hand at midnight.
- Product design philosophy: built for speed and legibility, not decoration.
- Why invoices are locked and returns use credit notes (trust and audit trail).

Suggested hashtags (validate with current trends): `#UAEBusiness #DubaiSMEs #SmallBusinessUAE #UAEVAT #POS #RetailUAE #ShopOwner #InvoiceApp #MadeForUAE`

## Brand and visual guidance

From the [product design spec](PRODUCT_DESIGN.md):

- **Style:** "premium utilitarian minimalism" — calm, precise, trustworthy. No gradients, glass effects, or flashy animation.
- **Colours:** warm bone background `#f7f6f3`, charcoal text/theme `#20211f`, white work surfaces, thin one-pixel borders, restrained pastel status colours (pale green = synced, pale yellow = offline, pale red = low stock / failed).
- **Typography:** Geist Sans (or Helvetica Neue) for text; Geist Mono for numbers and invoice data.
- **Icon:** `public/icon.svg`. Icons in the app use the Phosphor icon set.
- **Tone of voice:** plain, confident, practical. Talk like a helpful shop accountant, not a tech startup. Short sentences; money in AED.
- **App names:** full name "Shop Ledger UAE"; short name "Shop Ledger". ("Shop Ledger UAE" is a working name — confirm the final brand before large campaigns.)

## Capturing screenshots and demos

- Run the app locally (`npm install`, then `npm run dev`, open `http://localhost:3000`). It ships with realistic demo data — e.g. products like "Arabic Coffee 250g" and "Premium Date Box", and sample customers such as "Mariam Trading LLC" — which is ideal for screenshots.
- Demo customer names, phone numbers, and TRNs are fictional; never use a real customer's data in marketing material.
- Best screens to capture: **Overview** (daily metrics + low stock), **New sale** (cart and Cash/Card buttons), **Invoice detail** (receipt/A4), **Register** close with variance, **Reports** with CSV export.
- Use a landscape desktop window (the installed app is designed for landscape) and also capture the mobile layout for social formats.
- For install/offline demos, use a production build (`npm run build` then `npm start`); development mode is not a reliable demo of offline behaviour.

## Useful terms for copywriters

| Term | Meaning |
|---|---|
| **TRN** | Tax Registration Number — the 15-digit UAE VAT number of a business |
| **Simplified tax invoice** | Invoice for consumer (walk-in) sales |
| **Full tax invoice** | Invoice for a VAT-registered business customer, showing their TRN |
| **Credit note** | Document issued for a return; reverses part or all of an invoice |
| **Register / till** | The cash drawer session for the day, opened and closed by the owner |
| **Variance** | Difference between expected cash and counted cash at close |
| **Fils** | 1/100 of a dirham (AED); the app stores money in fils for precise totals |
| **PWA** | Progressive Web App — a website that installs and behaves like an app |
| **SKU** | Stock Keeping Unit — the shop's own product code |

## Ideas for future marketing (depends on roadmap)

These are not built yet; good to know for positioning, but don't promise them: Arabic interface, cloud sync and multi-device access, staff accounts, multiple branches or tills, supplier/purchase management, accounting integrations, live UAE e-invoicing, and e-commerce.
