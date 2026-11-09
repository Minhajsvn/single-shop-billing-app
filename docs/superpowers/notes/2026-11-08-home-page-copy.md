# billo home page copy (draft 1)

Date: 2026-11-08. Built from the keyword research in `2026-11-08-seo-keyword-research.md` and the claims rules in
`docs/PRODUCT_OVERVIEW_AND_MARKETING.md`. Read the claims check (end of this file) before publishing.

- **Primary keyword:** POS software UAE
- **Secondary:** billing software Dubai, VAT billing software UAE, offline POS system, cash register app
- **URL:** `/`
- **Voice:** a helpful shop accountant. Plain, confident, short sentences, money in AED.

---

## SEO metadata

- **Title tag (55 chars):** `billo: POS and billing software for UAE shops`
- **Meta description (154 chars):** `Ring up sales, print VAT invoices with your TRN, track stock and close the till. billo keeps selling when the internet drops. 14-day free trial, no card.`
- **Open Graph title:** `billo: the till that keeps selling`
- **Open Graph description:** `POS and VAT billing for UAE shops. Fast checkout, 80mm receipts, stock alerts and a cash register that balances.`
- **OG image text:** "The till that keeps selling." plus the receipt tile logo on Billo Green.

---

## 1. Hero

**Eyebrow:** POS software for shops in the UAE

**H1:** The till that keeps selling, even offline

**Subheadline:** billo is POS and billing software for UAE shops. Scan, take cash or card, and print a VAT invoice
with your TRN in seconds. When the internet drops, the till keeps going and syncs when it's back.

**Primary CTA:** Start your free 14-day trial
**CTA note (under the button):** No card needed. Set up in 10 minutes.
**Secondary CTA:** ▶ Watch the 60-second tour *(opens `billo-teaser-16x9.mp4` in a modal)*

**Background:** `billo-loop-receipt.webm` (muted loop).
**Alt / aria-label:** "A billo receipt printing with the shop's TRN and 5% VAT."

---

## 2. Proof strip (three short points under the hero)

- **Under 30 seconds a sale.** Scan, press F2, receipt prints.
- **5% VAT on every line.** Net, VAT and total are worked out for you.
- **Close the day in 5 minutes.** Count the drawer. See over or short at once.

---

## 3. Features (H2 + feature blocks, each linking to its own page)

**H2:** Everything the counter needs. Nothing it doesn't.

### Keeps selling when the internet drops
Wi-Fi gone? Keep serving customers. Sales queue on the till and sync once when the connection is back. No
duplicate invoices, no lost sales.
*Video:* `offline-16x9.mp4` · *Link:* "How offline selling works →" `/offline-pos`

### VAT invoices with your TRN, done right
Walk-in customers get a simplified tax invoice. Pick a business customer with a TRN and billo prints a full tax
invoice. Every invoice shows your legal name, address and TRN, and locks once issued.
*Video:* `trn-16x9.mp4` · *Link:* "See the invoice formats →" `/vat-invoice`

### A cash register that balances
Open the day with your float. At close, billo works out what should be in the drawer, keeps card totals separate,
and shows the variance. Print the day report or send the CSV to your accountant.
*Video:* `close-day-16x9.mp4` (inline loop: `billo-loop-variance.webm`) · *Link:* "Closing the day →" `/close-day`

### Returns without the mess
Return an item and billo issues a credit note linked to the original invoice, puts the stock back and records the
refund. The original invoice is never changed.
*Video:* `returns-16x9.mp4` · *Link:* "Returns and credit notes →" `/returns`

### Know before you run out
Set a low-stock level per product. billo flags it on the dashboard before the shelf is empty. Every stock change
keeps a reason and a history.
*Video:* `lowstock-16x9.mp4` · *Link:* "Stock and alerts →" `/stock`

---

## 4. Built for speed (keyboard section)

**H2:** Fast at the counter

Your cashier never needs the mouse. `/` to search, `F2` for cash, `F3` for card. Works with the barcode scanner you
already own. Scan the same item twice and the quantity goes up.

*Video:* `keyboard-16x9.mp4`

**Small list under the video:**
- Works with USB barcode scanners
- 80mm thermal receipts and A4 invoices
- Import products from a CSV, print barcode labels
- Runs in Chrome or Edge. Install it like a desktop app.

---

## 5. Full walkthrough

**H2:** See a full day in billo

Open the till, make sales, take a return and close the day, start to finish.

*Embed:* `walkthrough.mp4` hosted on YouTube (click-to-load, poster image first).

---

## 6. Pricing

**H2:** Simple pricing in AED

**Starter**: **AED 99 / month**, or **AED 990 / year** (2 months free)
- One shop, one till
- Up to 2 users
- Up to 5,000 products
- VAT invoices, stock, customers, returns, cash register and reports
- Offline selling and sync

**Free trial**: **14 days, no card needed**
Try everything, including Pro features that are live. Choose a plan when your trial ends.

**CTA:** Start your free trial
**Under the CTA:** Cancel anytime from Settings → Billing.

*(Pro and Business: don't show them on the page until their Stage 2 features ship.)*

---

## 7. FAQ (H2: Questions shop owners ask) — mark up as `FAQPage`

**Does billo work without internet?**
Yes, through outages. The till keeps taking sales and printing receipts. Everything syncs once the connection is
back, without duplicate invoices. You need internet to sign up and for the first sign-in on a till.

**Is billo VAT compliant in the UAE?**
billo is built for UAE 5% VAT invoicing. Every invoice shows net, VAT and total, your TRN, and a sequential number.
It issues simplified tax invoices for walk-ins and full tax invoices for customers with a TRN. Check your setup
with your tax adviser.

**What about UAE e-invoicing in 2027?**
Small businesses must start e-invoicing in mid-2027. billo's invoice data is already structured for it, and we're
preparing e-invoicing support ahead of the deadline. We'll tell you before you need to act.

**What hardware do I need?**
A Windows PC, laptop or tablet with Chrome or Edge. Optional: a USB barcode scanner, an 80mm thermal receipt
printer and a cash drawer. Take card payments on your existing card machine and record them in billo.

**Can I import my products?**
Yes. Upload a CSV from Excel or your old system, match the columns and import. You can also print barcode labels.

**Is my data safe?**
Your shop's data is stored on our servers and cached on the till. Customer details saved on the device are
encrypted. Issued invoices can't be edited or deleted.

**Can I cancel?**
Yes, anytime from Settings → Billing. No contracts.

---

## 8. Final CTA

**H2:** Ready for a till that keeps up?

Start your 14-day free trial today. No card, no setup fee, no hardware to buy.

**Button:** Start your free trial

---

## 9. Footer

billo is operated by MOHAMMED MINHAJ. Links: Pricing · Contact · Terms · Privacy · Refunds.

---

## Structured data (for step 4)

- `SoftwareApplication`: name "billo", applicationCategory "BusinessApplication", operatingSystem "Web, Windows",
  offers { price 99, priceCurrency "AED" }, areaServed "AE".
- `Organization`: name "billo", url `https://billoae.com`, logo `/icon-512.png`.
- `FAQPage`: the 7 questions above.
- `VideoObject` for each embedded film. Needs a name, description, thumbnail, duration and upload date for each.

---

## Claims check (confirm before publishing)

1. **Trial wording.** The site says "14-day Pro trial, no card needed" (`lib/billing/price-text.ts`). Keep the copy
   in step with that text. During Stage 1 the trial only unlocks Pro features that exist.
2. **"Set up in 10 minutes"** and **"under 30 seconds a sale"** are product targets, not measured numbers. Time
   them once before launch, or soften them to "minutes" and "seconds".
3. **Offline:** say "keeps selling through outages". Don't say "works fully offline" (sign-up and the first sign-in
   need internet).
4. **Cloud:** hosted sync is live, so "stored on our servers" is accurate. `PRODUCT_OVERVIEW_AND_MARKETING.md`
   still says it isn't. Update that doc.
5. **Tax:** never "FTA-approved" or "FTA-certified". "Built for UAE 5% VAT" only. Have a UAE tax adviser read the
   VAT FAQ answer.
6. **E-invoicing:** the FAQ answer promises preparation, not compliance. Keep it that way until an e-invoicing
   provider (ASP) is chosen.
7. **Arabic:** not mentioned anywhere. Leave it out until the Arabic UI ships.
8. **Support email** is still `[SUPPORT EMAIL]` in `lib/site-info.ts`. Fill it in before launch.
